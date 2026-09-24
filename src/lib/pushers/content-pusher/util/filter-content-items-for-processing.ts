import ansiColors from "ansi-colors";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { findContentInTargetInstance } from "./find-content-in-target-instance";
import { ApiClient, ContentItem } from "@agility/management-sdk";
import { Logs } from "core/logs";
import { state } from "core";
import { preflightReport } from "../../../preflight/preflight-report";

/**
 * Filter content items for processing
 * Moved from orchestrate-pushers.ts for better separation of concerns
 */
export interface ContentFilterResult {
  itemsToProcess: any[];
  itemsToSkip: any[];
  skippedCount: number;
}

interface FilterProp {
  contentItems: ContentItem[];
  apiClient: ApiClient;
  targetGuid: string;
  locale: string;
  referenceMapper: ContentItemMapper;
  targetData: ContentItem[];
  logger: Logs;
}

export async function filterContentItemsForProcessing({
  contentItems,
  apiClient,
  targetGuid,
  locale,
  referenceMapper,
  targetData = [],
  logger,
}: FilterProp): Promise<ContentFilterResult> {
  const itemsToProcess: any[] = [];
  const itemsToSkip: any[] = [];

  // Track decision stats for summary logging
  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let conflictCount = 0;

  for (const contentItem of contentItems) {
    const itemName = contentItem.properties.referenceName || "Unknown";

    try {
      const findResult = findContentInTargetInstance({
        sourceContent: contentItem,
        referenceMapper,
      });

      const { content, shouldUpdate, shouldCreate, shouldSkip, isConflict, reason } = findResult;
      if (isConflict) {
        // CONFLICT DETECTED - log warning and skip
        // PROD-2603: a mapped target item that no longer exists is also reported as a conflict, so
        // pick the headline from the reason rather than hard-coding "changes detected in both".
        const headline = /no longer exists/i.test(reason || "")
          ? "mapped target item no longer exists"
          : "changes detected in both source and target";
        console.warn(
          `⚠️  Conflict detected content ${ansiColors.underline(itemName)} ${ansiColors.bold.grey(headline)}. Please resolve manually.`
        );
        if (reason) {
          console.warn(`   ${reason}`);
        }
        itemsToSkip.push(contentItem);
        conflictCount++;
        preflightReport.record({
          phase: "Content",
          action: "conflict",
          name: itemName,
          locale,
          detail: reason || "changes detected in both source and target",
        });
        continue;
      } else if (shouldCreate) {
        // Content doesn't exist - include it for creation
        itemsToProcess.push(contentItem);
        createCount++;
        preflightReport.record({ phase: "Content", action: "create", name: itemName, locale });
      } else if (shouldUpdate) {
        // Content exists but needs updating
        itemsToProcess.push(contentItem);
        updateCount++;
        preflightReport.record({ phase: "Content", action: "update", name: itemName, locale });
      } else if (shouldSkip) {
        // Content exists and is up to date - skip
        logger.content.skipped(contentItem, "up to date, skipping", locale, targetGuid);
        itemsToSkip.push(contentItem);
        skipCount++;
        preflightReport.record({ phase: "Content", action: "skip", name: itemName, locale, detail: "up to date" });
      }
    } catch (error: any) {
      // If we can't check, err on the side of processing it
      logger.content.error(contentItem, error.message, locale, targetGuid);
      itemsToProcess.push(contentItem);
    }
  }

  // Log decision summary if verbose
  if (state.verbose && contentItems.length > 0) {
    console.log(
      ansiColors.gray(
        `[FilterContent] Decision summary: ${createCount} create, ${updateCount} update, ${skipCount} skip, ${conflictCount} conflict`
      )
    );
  }

  return {
    itemsToProcess,
    itemsToSkip,
    skippedCount: itemsToSkip.length,
  };
}
