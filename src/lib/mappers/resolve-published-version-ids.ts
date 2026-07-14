/**
 * Resolve Published Version IDs (PROD-2311)
 *
 * After auto-publish, the post-publish bookkeeping needs each just-published
 * item's new targetVersionID. The old approach read the start-of-run filesystem
 * snapshot, which does not contain items CREATED during the same run — so those
 * lookups failed ("not found in filesystem") and the mapping's targetVersionID
 * was left stale, causing change-detection drift on the next sync.
 *
 * Instead we poll the Fetch layer (via @agility/content-fetch, preview mode)
 * until each item's observed versionID DIVERGES from its pre-publish baseline:
 *   - updated item:  baseline = mapping.targetVersionID  → wait until observed != baseline
 *   - created item:  baseline = 0 (absent)               → wait until it appears (any versionID)
 *
 * Why this is safe (no source mismatch / no drift): for PUBLISHED items the
 * preview and fetch layers return the same version, and content-fetch shares
 * the datasource with content-sync (the pull). So a versionID read here equals
 * what the pull writes and what change-detection later compares against.
 *
 * The Fetch-API sync status is used ONLY as a backoff hint (wait smartly while a
 * CDN sync is in progress) — never as an exit condition. The exit condition is
 * divergence, or the hard timeout.
 */

import * as agilityFetch from "@agility/content-fetch";
import { Auth } from "../../core/auth";
import { getApiKeysForGuid } from "../../core/state";
import { getFetchApiStatus, waitForFetchApiSync, FetchApiSyncMode } from "../shared/get-fetch-api-status";

// getApi is a runtime export of @agility/content-fetch but is not surfaced in
// the package's type declarations, so we reach it via a cast.
const getApi = (agilityFetch as any).getApi as (config: any) => any;

/** Max wall-clock to wait for CDN propagation before giving up (per locale batch). */
export const POLL_TIMEOUT_MS = 60_000;
/** Delay between polls when NO sync is in progress (the post-publish registration-race window). */
export const POLL_BACKOFF_MS = 2_000;
/** Hard iteration cap as a belt-and-suspenders backstop on top of the wall-clock deadline. */
export const POLL_MAX_ITERATIONS = 1_000;

/** What we observe for a single item on the Fetch layer (null = not present yet). */
export interface ObservedItem {
  versionID: number;
  name?: string;
  refName?: string;
  modelName?: string;
}

export interface VersionResolutionItem {
  id: number;
  /** Pre-publish versionID from the mapping; 0 means the item is new (absent). */
  baseline: number;
}

export interface VersionResolutionResult {
  /** id -> the freshly observed item (versionID diverged from baseline). */
  resolved: Map<number, ObservedItem>;
  /** New items (baseline 0) that never appeared before the timeout — surface as non-blocking warnings. */
  missingCreates: number[];
  /** Updated items whose versionID never diverged (e.g. no-op republish) — keep the baseline silently. */
  unchangedUpdates: number[];
}

/** Injectable dependencies so the poll loop is unit-testable without real timers/network. */
export interface PollDeps {
  getStatus: (guid: string, mode: FetchApiSyncMode) => Promise<{ inProgress: boolean }>;
  waitForSync: (guid: string, mode: FetchApiSyncMode) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: PollDeps = {
  getStatus: async (guid, mode) => getFetchApiStatus(guid, mode, false),
  waitForSync: async (guid, mode) => {
    await waitForFetchApiSync(guid, mode, true /* silent */);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export interface PollOptions {
  guid: string;
  mode?: FetchApiSyncMode;
  timeoutMs?: number;
  backoffMs?: number;
  maxIterations?: number;
  deps?: Partial<PollDeps>;
}

/**
 * Poll the Fetch layer until each item diverges from its baseline (or timeout).
 *
 * @param items       items to resolve, each with its pre-publish baseline
 * @param fetchItem   resolves an item's current Fetch-layer state (null if not present yet)
 */
export async function resolvePublishedVersionIDs(
  items: VersionResolutionItem[],
  fetchItem: (id: number) => Promise<ObservedItem | null>,
  options: PollOptions
): Promise<VersionResolutionResult> {
  const mode: FetchApiSyncMode = options.mode ?? "preview";
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? POLL_BACKOFF_MS;
  const maxIterations = options.maxIterations ?? POLL_MAX_ITERATIONS;
  const deps: PollDeps = { ...defaultDeps, ...options.deps };

  const resolved = new Map<number, ObservedItem>();
  // id -> baseline for the items still awaiting divergence
  const remaining = new Map<number, number>(items.map((i) => [i.id, i.baseline]));

  const deadline = deps.now() + timeoutMs;
  let iterations = 0;

  while (remaining.size > 0 && deps.now() < deadline && iterations < maxIterations) {
    iterations++;

    // Backoff hint: if a CDN sync is in progress, wait for it to finish before
    // fetching (efficient). inProgress is a HINT ONLY — not an exit condition.
    const status = await deps.getStatus(options.guid, mode);
    if (status.inProgress) {
      await deps.waitForSync(options.guid, mode);
    }

    // Fetch each remaining item; resolve the ones that have diverged.
    for (const [id, baseline] of Array.from(remaining.entries())) {
      const observed = await fetchItem(id);
      if (observed && observed.versionID !== baseline) {
        resolved.set(id, observed);
        remaining.delete(id);
      }
    }

    if (remaining.size === 0) break;

    // Not fully resolved. If no sync was in progress, we're in the propagation
    // window (or the sync hasn't registered yet) — sleep before re-polling so we
    // don't hot-loop. If a sync WAS in progress we already waited on it above, so
    // loop straight back and re-check status.
    if (!status.inProgress) {
      await deps.sleep(backoffMs);
    }
  }

  // Classify whatever never diverged.
  const missingCreates: number[] = [];
  const unchangedUpdates: number[] = [];
  for (const [id, baseline] of Array.from(remaining.entries())) {
    if (baseline === 0) {
      // New item that never appeared on the Fetch API — a real problem, warn.
      missingCreates.push(id);
    } else {
      // Existing item whose version never changed (e.g. no-op republish). The
      // baseline is already correct, so keep it silently — no drift, no error.
      unchangedUpdates.push(id);
    }
  }

  return { resolved, missingCreates, unchangedUpdates };
}

/**
 * Build a content-fetch API client for the target instance (preview layer),
 * mirroring how download-sync-sdk.ts configures the sync client:
 * previewKey + `${determineFetchUrl(guid)}/${guid}` as the baseUrl.
 */
function buildFetchApi(guid: string): any {
  const { previewKey: apiKey } = getApiKeysForGuid(guid);
  const fetchUrl = new Auth().determineFetchUrl(guid);
  return getApi({
    guid,
    apiKey,
    isPreview: true,
    // content-fetch composes `${baseUrl}/${fetch|preview}/${locale}/item/{id}`,
    // so the guid must be part of baseUrl (same shape the sync SDK uses).
    baseUrl: `${fetchUrl}/${guid}`,
  });
}

/** Returns a fetcher that reads a content item's current versionID from the Fetch layer. */
export function makeContentVersionFetcher(
  guid: string,
  locale: string
): (id: number) => Promise<ObservedItem | null> {
  const api = buildFetchApi(guid);
  return async (contentID: number) => {
    try {
      const item = await api.getContentItem({ contentID, locale });
      const versionID = item?.properties?.versionID;
      if (typeof versionID !== "number") return null;
      return {
        versionID,
        name: item?.fields?.title || item?.fields?.name || `Item ${contentID}`,
        refName: item?.properties?.referenceName,
        modelName: item?.properties?.definitionName,
      };
    } catch {
      // Not on the CDN yet (or transient) — treat as "not present, keep polling".
      return null;
    }
  };
}

/** Returns a fetcher that reads a page's current versionID from the Fetch layer. */
export function makePageVersionFetcher(
  guid: string,
  locale: string
): (id: number) => Promise<ObservedItem | null> {
  const api = buildFetchApi(guid);
  return async (pageID: number) => {
    try {
      const page = await api.getPage({ pageID, locale });
      const versionID = page?.properties?.versionID;
      if (typeof versionID !== "number") return null;
      return {
        versionID,
        name: page?.title || page?.name || `Page ${pageID}`,
        refName: page?.name ? `/${page.name}` : undefined,
      };
    } catch {
      return null;
    }
  };
}
