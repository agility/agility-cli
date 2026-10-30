// Removed finder imports - using mapper directly
import ansiColors from "ansi-colors";
// Removed ContentBatchProcessor import - individual pusher only handles individual processing
import { getLoggerForGuid, state, registerFailedContent } from "core/state";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { ContentValidationFailure, filterContentItemsForProcessing } from "./util/filter-content-items-for-processing";
import { getContentItemTypes } from "./util/get-content-item-types";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContentItem, Model } from "@agility/management-sdk";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { getApiClient } from "core/state";
import { reportForeignCdnReferences } from "./util/report-foreign-cdn-references";
import { BatchProcessingResult } from "./util/types";

/**
 * Push content to the target instance
 */
export async function pushContent(sourceData: ContentItem[], targetData: ContentItem[], locale: string): Promise<any> {
  // Use batch pusher for better performance (default behavior)
  const { ContentBatchProcessor } = await import("./content-batch-processor");

  const { sourceGuid, targetGuid, overwrite, cachedApiClient: apiClient } = state;
  const logger = getLoggerForGuid(sourceGuid);

  const sourceGuidStr = sourceGuid;
  const targetGuidStr = targetGuid;

  const modelMapper = new ModelMapper(sourceGuidStr, targetGuidStr);
  const containerMapper = new ContainerMapper(sourceGuidStr, targetGuidStr);
  const referenceMapper = new ContentItemMapper(sourceGuidStr, targetGuidStr, locale);
  const contentItems = sourceData || [];

  if (contentItems.length === 0) {
    return { status: "success" as const, successful: 0, failed: 0, skipped: 0, publishableIds: [], failureDetails: [] };
  }

  // Deterministically classify content items by references: linked (referenced, split into
  // dependency levels), normal (unreferenced) and skipped (missing mappings)
  const { normalContentItems, linkedContentItems, linkedContentLevels, skippedItems } = getContentItemTypes(contentItems, {
    containerMapper,
    modelMapper,
    referenceMapper,
    logger: logger as any,
  });

  // PROD-2773: warn about asset URLs into a CDN container owned by neither instance. Reporting
  // only — runs before change detection (and in --preflight) and never alters an item. Items
  // skipped above for missing container/model mappings are not synced, so they are not scanned.
  try {
    reportForeignCdnReferences([...linkedContentItems, ...normalContentItems], locale, {
      sourceGuid: sourceGuidStr,
      targetGuid: targetGuidStr,
      logger,
    });
  } catch (scanError: any) {
    logger?.fileOnly?.(`Foreign CDN reference scan failed: ${scanError?.message || scanError}`);
  }

  let totalSuccessful = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const allPublishableIds: number[] = [];
  const allFailureDetails: Array<{
    name: string;
    error: string;
    type?: "content" | "page";
    contentID?: number;
    guid?: string;
    locale?: string;
    model?: string;
    fields?: string[];
  }> = [];

  // PROD-2542: items the filter rejected client-side (missing required field on the target model).
  // Register each in the failed-content registry right away, so the next pass's parents and the
  // page pusher can say why their reference is unresolved. In preflight that is all — the filter
  // already recorded them as "invalid" — so they count as skips and never touch the exit code; in a
  // real run they are failures with full detail (console/log, ERROR SUMMARY, --jsonSummary).
  const reportValidationFailures = (failures: ContentValidationFailure[]): void => {
    for (const { item, error, model, missing } of failures) {
      const name = item.properties?.referenceName || "Unknown";
      if (item.contentID) {
        registerFailedContent(item.contentID, name, error, locale);
      }
      if (state.preflight) {
        totalSkipped++;
        continue;
      }
      logger.content.error(item, error, locale, targetGuidStr);
      totalFailed++;
      allFailureDetails.push({
        name,
        error,
        type: "content",
        contentID: item.contentID,
        guid: sourceGuidStr,
        locale,
        model,
        fields: missing.map((m) => `${m.name} (${m.type})`),
      });
    }
  };

  // Fold one processBatches result into the totals; register each failure so the next pass's
  // parents and the page pusher can say why their reference is unresolved.
  const recordBatchResult = (result: BatchProcessingResult): void => {
    totalSuccessful += result.successCount;
    totalFailed += result.failureCount;
    totalSkipped += result.skippedCount;
    allPublishableIds.push(...result.publishableIds);
    for (const item of result.failedItems || []) {
      const name = item.originalContent?.properties?.referenceName || "Unknown";
      const contentID = item.originalContent?.contentID;
      allFailureDetails.push({
        name,
        error: item.error,
        type: "content",
        contentID,
        guid: sourceGuidStr,
        locale,
      });
      if (contentID) {
        registerFailedContent(contentID, name, item.error, locale);
      }
    }
  };

  try {
    // Import getApiClient for both batch configurations

    // Account for pre-classification skips (missing mappings)
    if (skippedItems && skippedItems.length > 0) {
      totalSkipped += skippedItems.length;
    }

    // Process linked content items first, one dependency level at a time (leaves first), so
    // the mappings each level references were written by an earlier level (PROD-3025).
    if (linkedContentItems.length > 0) {
      const linkedBatchConfig = {
        apiClient: getApiClient(),
        targetGuid: targetGuidStr,
        sourceGuid: sourceGuidStr,
        locale,
        referenceMapper,
        batchSize: 250,
        useContentFieldMapper: true,
        defaultAssetUrl: "",
      };

      const filteredLinkedContentItems = await filterContentItemsForProcessing({
        contentItems: linkedContentItems,
        apiClient: getApiClient(),
        targetGuid: targetGuidStr,
        locale,
        referenceMapper,
        targetData,
        logger,
        sourceGuid: sourceGuidStr,
      });
      reportValidationFailures(filteredLinkedContentItems.itemsToFail);

      // Preflight (PROD-2203): the filter has already recorded create/update/skip/conflict.
      // Skip the batch write entirely so nothing is sent to the target, but keep
      // processing the remaining (normal) content so its actions are reported too.
      if (state.preflight) {
        totalSuccessful += filteredLinkedContentItems.itemsToProcess.length;
        totalSkipped += filteredLinkedContentItems.skippedCount;
      } else {
        totalSkipped += filteredLinkedContentItems.skippedCount;
        const levels = splitIntoLevels(filteredLinkedContentItems.itemsToProcess, linkedContentLevels);
        const linkedBatchProcessor = new ContentBatchProcessor(linkedBatchConfig);
        for (let i = 0; i < levels.length; i++) {
          const label = levels.length > 1 ? `Linked Content (level ${i + 1}/${levels.length})` : "Linked Content";
          recordBatchResult(await linkedBatchProcessor.processBatches(levels[i], logger, label));
        }
      }
    }

    // Process normal content items first (no dependencies)
    if (normalContentItems.length > 0) {
      const normalBatchConfig = {
        apiClient: getApiClient(),
        targetGuid: targetGuidStr,
        sourceGuid: sourceGuidStr,
        locale,
        referenceMapper,
        batchSize: 100, // Smaller batches for linked content due to complexity
        useContentFieldMapper: true,
        defaultAssetUrl: "",
      };

      const filteredNormalContentItems = await filterContentItemsForProcessing({
        contentItems: normalContentItems,
        apiClient: getApiClient(),
        targetGuid: targetGuidStr,
        locale,
        referenceMapper,
        targetData,
        logger,
        sourceGuid: sourceGuidStr,
      });
      reportValidationFailures(filteredNormalContentItems.itemsToFail);
      // Preflight (PROD-2203): filter already recorded the actions; skip the write.
      if (state.preflight) {
        totalSuccessful += filteredNormalContentItems.itemsToProcess.length;
        totalSkipped += filteredNormalContentItems.skippedCount;
      } else {
        const normalBatchProcessor = new ContentBatchProcessor(normalBatchConfig);
        const normalResult = await normalBatchProcessor.processBatches(
          filteredNormalContentItems.itemsToProcess as ContentItem[],
          logger,
          "Normal Content"
        );

        totalSkipped += filteredNormalContentItems.skippedCount;
        recordBatchResult(normalResult);
      }
    }

    // Convert batch result to expected PusherResult format
    return {
      status: (totalFailed > 0 ? "error" : "success") as "success" | "error",
      successful: totalSuccessful,
      failed: totalFailed,
      skipped: totalSkipped,
      publishableIds: allPublishableIds,
      failureDetails: allFailureDetails,
    };
  } catch (batchError: any) {
    console.error(ansiColors.red(`❌ Batch processing failed: ${batchError.message}`));
    return {
      status: "error" as const,
      successful: totalSuccessful,
      failed: totalFailed + 1,
      skipped: totalSkipped,
      publishableIds: allPublishableIds,
      failureDetails: [...allFailureDetails, { name: "Batch processing", error: batchError.message }],
    };
  }
}

/**
 * Groups the items left after filtering by their dependency level (PROD-3025), dropping levels
 * the filter emptied. An item missing from every level goes last, after everything it could need.
 */
export function splitIntoLevels(items: ContentItem[], levels: ContentItem[][]): ContentItem[][] {
  const levelById = new Map<number, number>();
  levels.forEach((level, i) => level.forEach((item) => levelById.set(item.contentID, i)));

  const grouped: ContentItem[][] = levels.map(() => []);
  const unplaced: ContentItem[] = [];
  for (const item of items) {
    const level = levelById.get(item.contentID);
    if (level === undefined) unplaced.push(item);
    else grouped[level].push(item);
  }
  grouped.push(unplaced);
  return grouped.filter((level) => level.length > 0);
}
