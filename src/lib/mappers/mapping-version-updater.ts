/**
 * Mapping Version Updater
 *
 * After publishing, updates the mappings with the new targetVersionIDs.
 * PROD-2311: versionIDs are resolved by polling the Fetch layer until each item
 * diverges from its pre-publish baseline (see resolve-published-version-ids.ts),
 * rather than reading a start-of-run filesystem snapshot that misses same-run creations.
 */

import { getLogger } from "../../core/state";
import { ContentItemMapper } from "./content-item-mapper";
import { PageMapper } from "./page-mapper";
import ansiColors from "ansi-colors";
import { MappingUpdateResult } from "../../types";
import {
  resolvePublishedVersionIDs,
  makeContentVersionFetcher,
  makePageVersionFetcher,
  POLL_TIMEOUT_MS,
} from "./resolve-published-version-ids";

/** Human-readable timeout for the "did not appear" warning message (PROD-2311). */
const POLL_TIMEOUT_SECONDS = Math.round(POLL_TIMEOUT_MS / 1000);

// Re-export type for convenience
export { MappingUpdateResult };

/**
 * Version change detail for logging
 */
export interface VersionChangeDetail {
  id: number;
  oldVersion: number;
  newVersion: number;
  changed: boolean;
  name?: string; // Content title/name or page title
  refName?: string; // Content referenceName or page path
  modelName?: string; // Content model (definitionName)
}

/**
 * Helper to log to both logger and capture lines
 */
function logLine(line: string, logLines: string[]): void {
  const logger = getLogger();
  if (logger) {
    logger.info(line);
  } else {
    console.log(line);
  }
  logLines.push(line);
}

/**
 * Update content item mappings with new targetVersionID after publishing
 * Only updates targetVersionID - sourceVersionID should only change during sync operations
 */
export async function updateContentMappingsAfterPublish(
  publishedContentIds: number[],
  sourceGuid: string,
  targetGuid: string,
  locale: string
): Promise<{ updated: number; errors: string[]; changes: VersionChangeDetail[] }> {
  const errors: string[] = [];
  const changes: VersionChangeDetail[] = [];
  let updated = 0;

  // Deduplicate IDs - API may return duplicates for nested content
  const uniqueContentIds = Array.from(new Set(publishedContentIds));

  if (uniqueContentIds.length === 0) {
    return { updated: 0, errors: [], changes: [] };
  }

  try {
    const contentMapper = new ContentItemMapper(sourceGuid, targetGuid, locale);

    // PROD-2311: resolve each published item's fresh versionID by polling the
    // Fetch layer until it diverges from its pre-publish baseline, instead of
    // reading the start-of-run filesystem snapshot (which misses items created
    // during this same run). Baseline = mapping's current targetVersionID (0 = new).
    const items = uniqueContentIds.map((id) => ({
      id,
      baseline: contentMapper.getContentItemMappingByContentID(id, "target")?.targetVersionID ?? 0,
    }));

    const fetchItem = makeContentVersionFetcher(targetGuid, locale);
    const { resolved, missingCreates } = await resolvePublishedVersionIDs(items, fetchItem, {
      guid: targetGuid,
      mode: "preview",
    });

    // Record the diverged versionIDs into the mappings.
    for (const [targetContentId, observed] of Array.from(resolved.entries())) {
      const result = contentMapper.updateTargetVersionID(targetContentId, observed.versionID);
      if (result.success) {
        updated++;
        changes.push({
          id: targetContentId,
          oldVersion: result.oldVersionID!,
          newVersion: result.newVersionID!,
          changed: result.oldVersionID !== result.newVersionID,
          name: observed.name,
          refName: observed.refName,
          modelName: observed.modelName,
        });
      } else {
        errors.push(`No mapping found for target content ID ${targetContentId}`);
      }
    }

    // New items that never propagated to the Fetch API within the timeout. These
    // are non-blocking mapping warnings (the content itself did publish).
    for (const targetContentId of missingCreates) {
      errors.push(
        `target content item ${targetContentId} did not appear on the Fetch API within ${POLL_TIMEOUT_SECONDS}s after publish; mapping version not updated`
      );
    }
    // Note: unchangedUpdates (baseline never diverged, e.g. no-op republish) are
    // intentionally left as-is — the existing targetVersionID is already correct.

    return { updated, errors, changes };
  } catch (error: any) {
    errors.push(`Content mapping update failed: ${error.message}`);
    return { updated, errors, changes: [] };
  }
}

/**
 * Update page mappings with new targetVersionID after publishing
 * Only updates targetVersionID - sourceVersionID should only change during sync operations
 */
export async function updatePageMappingsAfterPublish(
  publishedPageIds: number[],
  sourceGuid: string,
  targetGuid: string,
  locale: string
): Promise<{ updated: number; errors: string[]; changes: VersionChangeDetail[] }> {
  const errors: string[] = [];
  const changes: VersionChangeDetail[] = [];
  let updated = 0;

  // Deduplicate IDs - API may return duplicates
  const uniquePageIds = Array.from(new Set(publishedPageIds));

  if (uniquePageIds.length === 0) {
    return { updated: 0, errors: [], changes: [] };
  }

  try {
    const pageMapper = new PageMapper(sourceGuid, targetGuid, locale);

    // PROD-2311: resolve fresh versionIDs by polling the Fetch layer until each
    // page diverges from its pre-publish baseline (see updateContentMappingsAfterPublish).
    const items = uniquePageIds.map((id) => ({
      id,
      baseline: pageMapper.getPageMappingByPageID(id, "target")?.targetVersionID ?? 0,
    }));

    const fetchItem = makePageVersionFetcher(targetGuid, locale);
    const { resolved, missingCreates } = await resolvePublishedVersionIDs(items, fetchItem, {
      guid: targetGuid,
      mode: "preview",
    });

    for (const [targetPageId, observed] of Array.from(resolved.entries())) {
      const result = pageMapper.updateTargetVersionID(targetPageId, observed.versionID);
      if (result.success) {
        updated++;
        changes.push({
          id: targetPageId,
          oldVersion: result.oldVersionID!,
          newVersion: result.newVersionID!,
          changed: result.oldVersionID !== result.newVersionID,
          name: observed.name,
          refName: observed.refName,
        });
      } else {
        errors.push(`No mapping found for target page ID ${targetPageId}`);
      }
    }

    for (const targetPageId of missingCreates) {
      errors.push(
        `target page ${targetPageId} did not appear on the Fetch API within ${POLL_TIMEOUT_SECONDS}s after publish; mapping version not updated`
      );
    }

    return { updated, errors, changes };
  } catch (error: any) {
    errors.push(`Page mapping update failed: ${error.message}`);
    return { updated, errors, changes: [] };
  }
}

/**
 * Format version change for display
 * Format: ● [guid][locale] content ID: {id} - Name (Type) v1565 → v1593 mapping updated
 */
function formatVersionChange(
  change: VersionChangeDetail,
  entityType: string,
  targetGuid: string,
  locale: string
): string {
  const symbol = change.changed ? ansiColors.green("●") : ansiColors.yellow("○");
  const guidDisplay = change.changed ? ansiColors.green(`[${targetGuid}]`) : ansiColors.yellow(`[${targetGuid}]`);
  const localeDisplay = ansiColors.gray(`[${locale}]`);
  const entityDisplay = ansiColors.white(entityType);
  const idDisplay = ansiColors.cyan.underline(String(change.id));
  const nameDisplay = ansiColors.white(change.name || "");

  // Build the type display (model name for content, path for pages)
  let typeDisplay = "";
  if (change.modelName) {
    typeDisplay = ansiColors.gray(` (${change.modelName})`);
  } else if (change.refName) {
    typeDisplay = ansiColors.gray(` (${change.refName})`);
  }

  if (change.changed) {
    const versionDisplay = ansiColors.gray(`v${change.oldVersion} → v${change.newVersion}`);
    const action = ansiColors.green("mapping updated");
    // Format: ● [guid][locale] content ID: {id} - Name (Type) v1565 → v1593 mapping updated
    return `${symbol} ${guidDisplay}${localeDisplay} ${entityDisplay} ID: ${idDisplay} - ${nameDisplay}${typeDisplay} ${versionDisplay} ${action}`;
  } else {
    const versionDisplay = ansiColors.gray(`v${change.newVersion}`);
    return `${symbol} ${guidDisplay}${localeDisplay} ${entityDisplay} ID: ${idDisplay} - ${nameDisplay}${typeDisplay} ${versionDisplay} ${ansiColors.gray("unchanged")}`;
  }
}

/**
 * Display version changes with summary and full details
 * Returns formatted lines for logging
 */
function displayVersionChanges(
  label: string,
  entityType: string,
  changes: VersionChangeDetail[],
  totalUpdated: number,
  targetGuid: string,
  locale: string,
  logLines: string[]
): void {
  if (changes.length === 0) return;

  // Show all items using the logger
  changes.forEach((change) => {
    const line = formatVersionChange(change, entityType, targetGuid, locale);
    logLine(line, logLines);
  });
}

/**
 * Update all mappings after publishing
 * Returns result and log lines for the logger
 */
export async function updateMappingsAfterPublish(
  publishedContentIds: number[],
  publishedPageIds: number[],
  sourceGuid: string,
  targetGuid: string,
  locale: string
): Promise<{ result: MappingUpdateResult; logLines: string[] }> {
  const logLines: string[] = [];

  logLine(ansiColors.cyan("\nUpdating mappings with new version IDs..."), logLines);

  const result: MappingUpdateResult = {
    contentMappingsUpdated: 0,
    pageMappingsUpdated: 0,
    errors: [],
  };

  // Update content mappings
  if (publishedContentIds.length > 0) {
    const contentResult = await updateContentMappingsAfterPublish(publishedContentIds, sourceGuid, targetGuid, locale);
    result.contentMappingsUpdated = contentResult.updated;
    result.errors.push(...contentResult.errors);

    displayVersionChanges(
      "content item",
      "content",
      contentResult.changes,
      contentResult.updated,
      targetGuid,
      locale,
      logLines
    );
  }

  // Update page mappings
  if (publishedPageIds.length > 0) {
    const pageResult = await updatePageMappingsAfterPublish(publishedPageIds, sourceGuid, targetGuid, locale);
    result.pageMappingsUpdated = pageResult.updated;
    result.errors.push(...pageResult.errors);

    displayVersionChanges("page", "page", pageResult.changes, pageResult.updated, targetGuid, locale, logLines);
  }

  // Summary line
  logLine(
    ansiColors.green(
      `✓ Mappings updated: ${result.contentMappingsUpdated} content, ${result.pageMappingsUpdated} pages`
    ),
    logLines
  );

  // Report any errors
  if (result.errors.length > 0) {
    logLine(ansiColors.yellow(`  ⚠️ ${result.errors.length} mapping update errors (see logs)`), logLines);
  }

  return { result, logLines };
}
