import ansiColors from "ansi-colors";
import { Logs } from "core/logs";
import { state, getLoggerForGuid } from "core/state";
import { UrlRedirectionMapper } from "lib/mappers/url-redirection-mapper";
import { UrlRedirectionSyncItem, UrlRedirectionSavePayload } from "../../types/urlRedirection";
import { preflightReport } from "../preflight/preflight-report";
import { saveUrlRedirections, MAX_URL_REDIRECTION_BATCH_SIZE } from "./url-redirection-api";

/** A queued create/update: the source item plus the payload the API will receive. */
interface PendingSave {
  source: UrlRedirectionSyncItem;
  payload: UrlRedirectionSavePayload;
  action: "create" | "update";
}

const normalizeOrigin = (url: string | null | undefined): string => (url ?? "").trim().toLowerCase();

/**
 * Pulled redirections carry no modifiedOn timestamp, so change detection is a direct
 * field comparison of the pulled source and target items (there is no
 * target-changed/conflict detection like galleries; an update is a full replace).
 */
function areEquivalent(a: UrlRedirectionSyncItem, b: UrlRedirectionSyncItem): boolean {
  return (
    normalizeOrigin(a.originUrl) === normalizeOrigin(b.originUrl) &&
    (a.destinationUrl ?? "").trim() === (b.destinationUrl ?? "").trim() &&
    (a.statusCode ?? 301) === (b.statusCode ?? 301) &&
    (a.destinationLocale ?? null) === (b.destinationLocale ?? null) &&
    JSON.stringify(a.originLocales ?? []) === JSON.stringify(b.originLocales ?? []) &&
    (a.content ?? null) === (b.content ?? null)
  );
}

function toSavePayload(item: UrlRedirectionSyncItem, targetUrlRedirectionID: number): UrlRedirectionSavePayload {
  return {
    urlRedirectionID: targetUrlRedirectionID, // 0 = create, positive = update (full replace)
    originUrl: item.originUrl,
    destinationUrl: item.destinationUrl,
    httpCode: item.statusCode ?? 301,
    destinationLocale: item.destinationLocale ?? null,
    originLocales: item.originLocales ?? null,
    content: item.content ?? null,
  };
}

/**
 * Push URL redirections from source to target using the batch save endpoint.
 * Creates and updates are sent together (up to 250 per request); the per-item
 * response is used to write source→target ID mappings.
 */
export async function pushUrlRedirections(
  sourceData: UrlRedirectionSyncItem[],
  targetData: UrlRedirectionSyncItem[]
): Promise<{ status: "success" | "error"; successful: number; failed: number; skipped: number }> {
  const redirections: UrlRedirectionSyncItem[] = sourceData || [];
  const targetRedirections: UrlRedirectionSyncItem[] = targetData || [];

  const { sourceGuid, targetGuid } = state;

  const logger = getLoggerForGuid(sourceGuid[0]) || new Logs("push", "urlRedirection", sourceGuid[0]);

  if (!redirections || redirections.length === 0) {
    console.log("No URL redirections found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  const mapper = new UrlRedirectionMapper(sourceGuid[0], targetGuid[0]);

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let overallStatus: "success" | "error" = "success";

  // Phase 1: classify every source redirection as create / update / skip.
  const pending: PendingSave[] = [];

  for (const source of redirections) {
    const mapping = mapper.getMapping(source.id, "source");
    const targetById = mapping
      ? targetRedirections.find((t) => t.id === mapping.targetUrlRedirectionID)
      : undefined;
    const targetByOrigin = targetRedirections.find((t) => normalizeOrigin(t.originUrl) === normalizeOrigin(source.originUrl));

    if (!mapping && targetByOrigin) {
      // Exists in target by origin URL but no mapping — adopt the mapping (map-on-adopt,
      // same self-heal behavior as galleries/models), then diff to decide update vs skip.
      mapper.addMapping(source.id, targetByOrigin.id, source.originUrl);
      if (areEquivalent(source, targetByOrigin)) {
        logger.urlRedirection.skipped(source, "already exists in target by origin URL", targetGuid[0]);
        preflightReport.record({
          phase: "URL Redirections",
          action: "skip",
          name: source.originUrl,
          detail: "already exists in target by origin URL",
        });
        skipped++;
      } else {
        pending.push({ source, payload: toSavePayload(source, targetByOrigin.id), action: "update" });
      }
    } else if (mapping && targetById) {
      if (areEquivalent(source, targetById)) {
        logger.urlRedirection.skipped(source, "up to date, skipping", targetGuid[0]);
        preflightReport.record({
          phase: "URL Redirections",
          action: "skip",
          name: source.originUrl,
          detail: "up to date",
        });
        skipped++;
      } else {
        pending.push({ source, payload: toSavePayload(source, targetById.id), action: "update" });
      }
    } else {
      // No mapping and no origin match, or the mapped target redirection was deleted — create.
      pending.push({ source, payload: toSavePayload(source, 0), action: "create" });
    }
  }

  // Preflight (PROD-2203): report what WOULD happen without calling the API.
  if (state.preflight) {
    for (const item of pending) {
      preflightReport.record({ phase: "URL Redirections", action: item.action, name: item.source.originUrl });
      successful++;
    }
    console.log(
      ansiColors.yellow(
        `Processed ${successful}/${redirections.length} URL redirections (${failed} failed, ${skipped} skipped)`
      )
    );
    return { status: overallStatus, successful, failed, skipped };
  }

  // Phase 2: send creates and updates together in batches of up to 250.
  for (let i = 0; i < pending.length; i += MAX_URL_REDIRECTION_BATCH_SIZE) {
    const batch = pending.slice(i, i + MAX_URL_REDIRECTION_BATCH_SIZE);

    try {
      const result = await saveUrlRedirections(
        targetGuid[0],
        batch.map((p) => p.payload)
      );

      // `index` is the zero-based position within THIS request's payload.
      for (const created of result.created) {
        const item = batch[created.index];
        if (item && created.urlRedirectionID) {
          mapper.addMapping(item.source.id, created.urlRedirectionID, item.source.originUrl);
          logger.urlRedirection.created(item.source, "created", targetGuid[0]);
        }
        successful++;
      }

      for (const updated of result.updated) {
        const item = batch[updated.index];
        if (item) {
          mapper.addMapping(
            item.source.id,
            updated.urlRedirectionID ?? item.payload.urlRedirectionID,
            item.source.originUrl
          );
          logger.urlRedirection.updated(item.source, "updated", targetGuid[0]);
        }
        successful++;
      }

      // Items the API refused individually (validation failure or origin URL collision).
      for (const skippedItem of result.skipped) {
        const item = batch[skippedItem.index];
        logger.urlRedirection.skipped(
          item?.source ?? { originUrl: skippedItem.originUrl },
          `skipped by API: ${skippedItem.reason || "no reason given"}`,
          targetGuid[0]
        );
        skipped++;
      }
    } catch (error: any) {
      // The endpoint is transactional per request, so the whole batch failed.
      failed += batch.length;
      overallStatus = "error";
      for (const item of batch) {
        logger.urlRedirection.error(item.source, error?.message || error, targetGuid[0]);
      }
    }
  }

  console.log(
    ansiColors.yellow(
      `Processed ${successful}/${redirections.length} URL redirections (${failed} failed, ${skipped} skipped)`
    )
  );
  return { status: overallStatus, successful, failed, skipped };
}
