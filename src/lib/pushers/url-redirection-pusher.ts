import ansiColors from "ansi-colors";
import { Logs } from "core/logs";
import { state, getLoggerForGuid } from "core/state";
import { UrlRedirectionMapper } from "lib/mappers/url-redirection-mapper";
import { UrlRedirectionSyncItem, UrlRedirectionSavePayload } from "../../types/urlRedirection";
import { preflightReport } from "../preflight/preflight-report";
import { saveUrlRedirections, MAX_URL_REDIRECTION_BATCH_SIZE } from "./url-redirection-api";
import { FailureDetail, PusherResult } from "../../types/sourceData";
import { keptTargetChanges } from "./kept-target-changes";
import { decideSync, fingerprintFields, hashShape, hasFingerprint, UNRECORDED_UPDATE_DETAIL } from "../shared/sync-fingerprint";

/** A queued create/update: the source item plus the payload the API will receive. */
interface PendingSave {
  source: UrlRedirectionSyncItem;
  payload: UrlRedirectionSavePayload;
  action: "create" | "update";
  /** Hash of the source's shape; stored for both sides once the save lands (a full replace). */
  hash: string;
  /** Preflight detail, e.g. why the source wins */
  detail?: string;
}

const normalizeOrigin = (url: string | null | undefined): string => (url ?? "").trim().toLowerCase();

/**
 * The fields that make two redirections the same, without the per-instance ID. Pulled redirections
 * carry no modifiedOn timestamp, so this shape is both the "differs" check and, hashed, the
 * fingerprint stored in the mapping to tell which side changed (PROD-3078).
 */
export function normalizeRedirection(item: UrlRedirectionSyncItem) {
  return {
    originUrl: normalizeOrigin(item.originUrl),
    destinationUrl: (item.destinationUrl ?? "").trim(),
    statusCode: item.statusCode ?? 301,
    destinationLocale: item.destinationLocale ?? null,
    originLocales: [...(item.originLocales ?? [])].sort(),
    content: item.content ?? null,
  };
}

export function redirectionHash(item: UrlRedirectionSyncItem): string {
  return hashShape(normalizeRedirection(item));
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
): Promise<PusherResult> {
  const redirections: UrlRedirectionSyncItem[] = sourceData || [];
  const targetRedirections: UrlRedirectionSyncItem[] = targetData || [];

  const { sourceGuid, targetGuid, overwrite } = state;

  const logger = getLoggerForGuid(sourceGuid) || new Logs("push", "urlRedirection", sourceGuid);

  if (!redirections || redirections.length === 0) {
    console.log("No URL redirections found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  const mapper = new UrlRedirectionMapper(sourceGuid, targetGuid);

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let overallStatus: "success" | "error" = "success";
  const failureDetails: FailureDetail[] = [];

  // Phase 1: classify every source redirection as create / update / skip / kept / conflict.
  const pending: PendingSave[] = [];
  const recordSkip = (source: UrlRedirectionSyncItem, detail: string, action: "skip" | "conflict" = "skip") => {
    logger.urlRedirection.skipped(source, detail, targetGuid);
    preflightReport.record({ phase: "URL Redirections", action, name: source.originUrl, detail });
    skipped++;
  };

  for (const source of redirections) {
    const mapping = mapper.getMapping(source.id, "source");
    const targetById = mapping
      ? targetRedirections.find((t) => t.id === mapping.targetUrlRedirectionID)
      : undefined;
    const targetByOrigin = targetRedirections.find((t) => normalizeOrigin(t.originUrl) === normalizeOrigin(source.originUrl));
    const sourceHash = redirectionHash(source);

    if (!mapping && targetByOrigin) {
      // Exists in target by origin URL but no mapping — adopt the mapping (map-on-adopt,
      // same self-heal behavior as galleries/models), then diff to decide update vs skip.
      // Nothing records which side changed yet, so a difference is settled by the source.
      const targetHash = redirectionHash(targetByOrigin);
      if (sourceHash === targetHash) {
        mapper.addMapping(source.id, targetByOrigin.id, source.originUrl, fingerprintFields(sourceHash, targetHash));
        recordSkip(source, "already exists in target by origin URL");
      } else {
        mapper.addMapping(source.id, targetByOrigin.id, source.originUrl);
        pending.push({
          source,
          payload: toSavePayload(source, targetByOrigin.id),
          action: "update",
          hash: sourceHash,
          detail: UNRECORDED_UPDATE_DETAIL,
        });
      }
    } else if (mapping && targetById) {
      const targetHash = redirectionHash(targetById);
      const decision = decideSync(sourceHash === targetHash, sourceHash, targetHash, mapping);
      const update = (detail?: string) =>
        pending.push({ source, payload: toSavePayload(source, targetById.id), action: "update", hash: sourceHash, detail });

      if (decision === "skip") {
        // Seed or refresh the hashes: an older mapping gets them here, and two sides edited to
        // the same value agree again.
        if (!hasFingerprint(mapping) || mapping.sourceHash !== sourceHash || mapping.targetHash !== targetHash) {
          mapper.addMapping(source.id, targetById.id, source.originUrl, fingerprintFields(sourceHash, targetHash));
        }
        recordSkip(source, "up to date");
      } else if (decision === "update") {
        update();
      } else if (decision === "update-unrecorded") {
        update(UNRECORDED_UPDATE_DETAIL);
      } else if (overwrite) {
        update(decision === "conflict" ? "conflict overwritten" : "target change overwritten");
      } else if (decision === "keep") {
        const change = {
          type: "urlRedirection" as const,
          name: source.originUrl,
          sourceID: source.id,
          targetID: targetById.id,
        };
        keptTargetChanges.record(change);
        console.warn(ansiColors.yellow(keptTargetChanges.formatLine(change)));
        recordSkip(source, "target changed since the last sync and the source didn't; kept the target's version");
      } else {
        recordSkip(source, "source and target both changed; use --overwrite to force", "conflict");
      }
    } else if (mapping && !overwrite) {
      // The mapped target redirection was deleted on the target. Like a deleted target template
      // (PROD-2603): a conflict, and --overwrite recreates it.
      recordSkip(
        source,
        `mapped target redirection (ID: ${mapping.targetUrlRedirectionID}) no longer exists on the target; use --overwrite to recreate it`,
        "conflict"
      );
    } else {
      // No mapping and no origin match, or (with --overwrite) the mapped target was deleted — create.
      pending.push({ source, payload: toSavePayload(source, 0), action: "create", hash: sourceHash });
    }
  }

  // Preflight (PROD-2203): report what WOULD happen without calling the API.
  if (state.preflight) {
    for (const item of pending) {
      preflightReport.record({
        phase: "URL Redirections",
        action: item.action,
        name: item.source.originUrl,
        ...(item.detail ? { detail: item.detail } : {}),
      });
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
        targetGuid,
        batch.map((p) => p.payload)
      );

      // `index` is the zero-based position within THIS request's payload.
      for (const created of result.created) {
        const item = batch[created.index];
        if (item && created.urlRedirectionID) {
          mapper.addMapping(
            item.source.id,
            created.urlRedirectionID,
            item.source.originUrl,
            fingerprintFields(item.hash, item.hash)
          );
          logger.urlRedirection.created(item.source, "created", targetGuid);
        }
        successful++;
      }

      for (const updated of result.updated) {
        const item = batch[updated.index];
        if (item) {
          mapper.addMapping(
            item.source.id,
            updated.urlRedirectionID ?? item.payload.urlRedirectionID,
            item.source.originUrl,
            // A full replace: the target now has the source's shape
            fingerprintFields(item.hash, item.hash)
          );
          logger.urlRedirection.updated(item.source, "updated", targetGuid);
        }
        successful++;
      }

      // Items the API refused individually (validation failure or origin URL collision).
      for (const skippedItem of result.skipped) {
        const item = batch[skippedItem.index];
        logger.urlRedirection.skipped(
          item?.source ?? { originUrl: skippedItem.originUrl },
          `skipped by API: ${skippedItem.reason || "no reason given"}`,
          targetGuid
        );
        skipped++;
      }
    } catch (error: any) {
      // The endpoint is transactional per request, so the whole batch failed.
      failed += batch.length;
      overallStatus = "error";
      for (const item of batch) {
        logger.urlRedirection.error(item.source, error?.message || error, targetGuid);
        failureDetails.push({
          name: item.source.originUrl,
          error: error?.message || String(error),
          type: "urlRedirection",
          guid: sourceGuid,
        });
      }
    }
  }

  console.log(
    ansiColors.yellow(
      `Processed ${successful}/${redirections.length} URL redirections (${failed} failed, ${skipped} skipped)`
    )
  );
  return { status: overallStatus, successful, failed, skipped, failureDetails };
}
