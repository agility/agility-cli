/**
 * PROD-3399: Components that aren't on any page ("unused Components").
 *
 * When an editor removes a Component from a page, or replaces it with a new one, the Component's
 * item is not deleted. It stays in the instance, the Management API still returns it, and so the
 * CLI's source pull has it. In the Manager a Component is opened through its page, so once it is off
 * every page nobody can open it. The sync used to push these like any other item: the ones that
 * break a rule on the target (a required field added to the model later, a link to content that
 * isn't synced) were reported as sync failures, and the rest were created on the target silently.
 *
 * The sync now skips them and reports them once, as "unused, skipped", instead of as errors.
 *
 * An item counts as an unused Component when all of these hold:
 *  - its container is a Component container (contentDefinitionTypeID 2) that is not a dynamic page
 *    list;
 *  - no page zone the CLI pulled places it, in any pulled locale;
 *  - no other item that is used links to it, by ID or by its container's reference name.
 *
 * Nothing is skipped when no page was pulled at all, since then nothing can be told apart.
 */
import * as fs from "fs";
import * as path from "path";
import { collectContentIDReferences } from "../pushers/content-pusher/util/collect-content-id-references";
import { collectListReferenceNames } from "../pushers/content-pusher/util/collect-list-reference-names";

export const COMPONENT_CONTAINER_TYPE_ID = 2;

export const UNUSED_COMPONENT_WARNING_CODE = "unusedComponentSkipped";

/** Why the item was skipped; shared by every surface. */
export const UNUSED_COMPONENT_REASON = "unused Component: not on any page, so it was skipped";

function lower(value: any): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/** A Component container (page module list), not a dynamic page list. */
export function isComponentContainer(container: any): boolean {
  if (!container || container.isDynamicPageList === true) return false;
  const typeID = container.contentDefinitionTypeID ?? container.contentDefinitionType;
  return typeID === COMPONENT_CONTAINER_TYPE_ID;
}

/** Content IDs that a page's zones place, across every zone. */
export function pageZoneContentIDs(page: any): number[] {
  const ids: number[] = [];
  const zones = page?.zones;
  if (!zones || typeof zones !== "object") return ids;
  for (const zone of Object.keys(zones)) {
    const modules = (zones as any)[zone];
    if (!Array.isArray(modules)) continue;
    for (const module of modules) {
      const item = (module as any)?.item;
      if (!item || typeof item !== "object") continue;
      const raw = item.contentid ?? item.contentID ?? item.ContentID;
      const id = typeof raw === "string" ? parseInt(raw, 10) : raw;
      if (typeof id === "number" && id > 0) ids.push(id);
    }
  }
  return ids;
}

export interface PlacedContentIDs {
  ids: Set<number>;
  /** Pages read. Zero means placement is unknown, and nothing may be treated as unused. */
  pageCount: number;
}

/** Placement from a list of pages. */
export function placedContentIDsFromPages(pages: any[]): PlacedContentIDs {
  const ids = new Set<number>();
  let pageCount = 0;
  for (const page of pages || []) {
    if (!page) continue;
    pageCount++;
    pageZoneContentIDs(page).forEach((id) => ids.add(id));
  }
  return { ids, pageCount };
}

/**
 * Placement from every pulled locale of one instance (`<rootPath>/<guid>/<locale>/page/*.json`),
 * plus any pages passed in. A Component placed only in another locale's page still counts as used.
 * Reading from disk, not the loaded pages, keeps a --pages scope from making the Components of
 * out-of-scope pages look unused. Unreadable files are left out (the loaders already warn about them).
 */
export function loadPlacedContentIDs(rootPath: string, guid: string, extraPages: any[] = []): PlacedContentIDs {
  const result = placedContentIDsFromPages(extraPages);
  const base = path.join(rootPath, guid);
  let locales: string[] = [];
  try {
    locales = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return result;
  }
  for (const locale of locales) {
    const dir = path.join(base, locale, "page");
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const page = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        result.pageCount++;
        pageZoneContentIDs(page).forEach((id) => result.ids.add(id));
      } catch {
        // unreadable: left out
      }
    }
  }
  return result;
}

/**
 * The unused Components among `content` (one locale's source items). `containers` and `models` are
 * the source instance's; models are only used to find links held in companion fields.
 */
export function findUnusedComponents(input: {
  content: any[];
  containers: any[];
  placed: PlacedContentIDs;
  models?: any[];
}): any[] {
  const { content, containers, placed } = input;
  if (!placed || placed.pageCount === 0) return [];

  const componentContainers = new Set<string>();
  for (const container of containers || []) {
    if (isComponentContainer(container)) componentContainers.add(lower(container.referenceName));
  }
  if (componentContainers.size === 0) return [];

  const candidates = new Map<number, any>();
  for (const item of content || []) {
    const id = item?.contentID;
    if (typeof id !== "number" || placed.ids.has(id)) continue;
    if (componentContainers.has(lower(item?.properties?.referenceName))) candidates.set(id, item);
  }
  if (candidates.size === 0) return [];

  // Who links to whom. A candidate another live item links to is used; so is one a used candidate
  // links to, so this runs until nothing changes.
  const modelsByRef = new Map<string, any>();
  for (const model of input.models || []) {
    const ref = lower(model?.referenceName);
    if (ref && !modelsByRef.has(ref)) modelsByRef.set(ref, model);
  }
  const candidatesByContainer = new Map<string, number[]>();
  candidates.forEach((item, id) => {
    const ref = lower(item?.properties?.referenceName);
    candidatesByContainer.set(ref, [...(candidatesByContainer.get(ref) || []), id]);
  });
  const linksOf = (item: any): number[] => {
    const model = modelsByRef.get(lower(item?.properties?.definitionName));
    const ids = collectContentIDReferences(item?.fields || {}, model).filter((id) => candidates.has(id));
    for (const listName of collectListReferenceNames(item?.fields || {})) {
      ids.push(...(candidatesByContainer.get(lower(listName)) || []));
    }
    return ids;
  };

  const used = new Set<number>();
  const pending: number[] = [];
  const markUsed = (id: number) => {
    if (candidates.has(id) && !used.has(id)) {
      used.add(id);
      pending.push(id);
    }
  };
  for (const item of content || []) {
    if (candidates.has(item?.contentID)) continue;
    linksOf(item).forEach(markUsed);
  }
  while (pending.length > 0) {
    const id = pending.pop() as number;
    linksOf(candidates.get(id)).forEach(markUsed);
  }

  return Array.from(candidates.values()).filter((item) => !used.has(item.contentID));
}

// ─── run report ──────────────────────────────────────────────────────────────

export interface UnusedComponentEntry {
  contentID: number;
  name: string;
  model?: string;
  locale: string;
  /** A target item an earlier sync created for it, still on the target. */
  targetID?: number;
}

export interface UnusedComponentWarningDetail {
  name: string;
  error: string;
  type: "content";
  guid?: string;
  locale?: string;
  contentID?: number;
  model?: string;
  code: typeof UNUSED_COMPONENT_WARNING_CODE;
  sourceID?: number;
  targetID?: number;
}

/** How many entries the end-of-run summary lists before pointing at the log file. */
const SUMMARY_LIST_LIMIT = 20;

/**
 * Per-run collector. Reporting only: skipped items count as skips and never affect `success` or the
 * exit code. A process-level singleton, like keptTargetChanges.
 */
class UnusedComponentsReport {
  private entries: UnusedComponentEntry[] = [];

  reset(): void {
    this.entries = [];
  }

  record(entry: UnusedComponentEntry): void {
    if (this.entries.some((e) => e.contentID === entry.contentID && e.locale === entry.locale)) return;
    this.entries.push(entry);
  }

  getEntries(): UnusedComponentEntry[] {
    return [...this.entries];
  }

  hasEntries(): boolean {
    return this.entries.length > 0;
  }

  /** Entries an earlier sync already created on the target. */
  onTarget(): UnusedComponentEntry[] {
    return this.entries.filter((e) => typeof e.targetID === "number");
  }

  /** "Unused Components skipped: 12 (not on any page)" */
  headline(): string {
    return `Unused Components skipped: ${this.entries.length} (not on any page)`;
  }

  /** One console/log line for an item, when it is skipped. */
  formatLine(entry: UnusedComponentEntry): string {
    const model = entry.model ? ` (${entry.model})` : "";
    const onTarget = entry.targetID ? `; an earlier sync created it on the target as ${entry.targetID}` : "";
    return `${entry.name}${model} #${entry.contentID}: ${UNUSED_COMPONENT_REASON}${onTarget}`;
  }

  /** Lines for the end-of-run summary: headline, an explanation, then the first items. */
  renderSummaryLines(): string[] {
    if (!this.hasEntries()) return [];
    const lines = [`${this.headline()}, non-blocking:`];
    lines.push(
      "  These Components were removed from or replaced on their pages but never deleted, so the Manager can't open them.",
      "  They aren't errors. To clear them for good, delete them in the source instance."
    );
    const onTarget = this.onTarget().length;
    if (onTarget > 0) {
      lines.push(
        `  ${onTarget} of them were created on the target by an earlier sync and are still there; this sync left them alone.`
      );
    }
    const byLocale = [...this.entries].sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
    byLocale.slice(0, SUMMARY_LIST_LIMIT).forEach((e) => {
      const model = e.model ? ` (${e.model})` : "";
      const onTargetNote = e.targetID ? `, on the target as ${e.targetID}` : "";
      lines.push(`  • [${e.locale}] ${e.name}${model} #${e.contentID}${onTargetNote}`);
    });
    if (byLocale.length > SUMMARY_LIST_LIMIT) {
      lines.push(`  …and ${byLocale.length - SUMMARY_LIST_LIMIT} more (see the log file)`);
    }
    return lines;
  }

  /** One --jsonSummary warning per skipped item. `guid` is the source. */
  toWarningDetails(sourceGuid?: string): UnusedComponentWarningDetail[] {
    return this.entries.map((e) => ({
      name: e.name,
      error: UNUSED_COMPONENT_REASON,
      type: "content",
      guid: sourceGuid,
      locale: e.locale,
      contentID: e.contentID,
      model: e.model,
      code: UNUSED_COMPONENT_WARNING_CODE,
      sourceID: e.contentID,
      targetID: e.targetID,
    }));
  }
}

export const unusedComponentsReport = new UnusedComponentsReport();
