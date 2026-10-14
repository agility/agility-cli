import ansiColors from "ansi-colors";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { findContentInTargetInstance } from "./find-content-in-target-instance";
import { ApiClient, ContentItem } from "@agility/management-sdk";
import { Logs } from "core/logs";
import { state } from "core";
import { preflightReport } from "../../../preflight/preflight-report";
import {
  RequiredFieldIssue,
  formatMissingRequiredFields,
  validateContentItemAgainstModel,
} from "./validate-required-fields";
import { createEffectiveTargetModelResolver } from "./resolve-effective-target-model";

/**
 * Filter content items for processing
 * Moved from orchestrate-pushers.ts for better separation of concerns
 */
export interface ContentFilterResult {
  itemsToProcess: any[];
  itemsToSkip: any[];
  skippedCount: number;
  // PROD-2542: items that would be written but are missing a required field on the target model.
  // They never reach itemsToProcess (so never a batch); the caller reports them as failures.
  itemsToFail: ContentValidationFailure[];
}

export interface ContentValidationFailure {
  item: ContentItem;
  error: string;
  model: string;
  missing: RequiredFieldIssue[];
}

interface FilterProp {
  contentItems: ContentItem[];
  apiClient: ApiClient;
  targetGuid: string;
  locale: string;
  referenceMapper: ContentItemMapper;
  targetData: ContentItem[];
  logger: Logs;
  // Source instance guid, for resolving the item's model (defaults to state.sourceGuid).
  sourceGuid?: string;
}

export async function filterContentItemsForProcessing({
  contentItems,
  apiClient,
  targetGuid,
  locale,
  referenceMapper,
  targetData = [],
  logger,
  sourceGuid = state.sourceGuid,
}: FilterProp): Promise<ContentFilterResult> {
  const itemsToProcess: any[] = [];
  const itemsToSkip: any[] = [];
  const itemsToFail: ContentValidationFailure[] = [];
  const resolveModel = createEffectiveTargetModelResolver(sourceGuid, targetGuid);

  // PROD-2542: validate the SOURCE fields (the field mapper preserves keys and nulls) against the
  // effective target model. Returns the failure when the item must not be sent; warnings are
  // logged and the item proceeds.
  const validateForWrite = (contentItem: ContentItem, itemName: string): ContentValidationFailure | null => {
    const definitionName = contentItem.properties?.definitionName || "";
    const model = resolveModel(definitionName);
    if (!model) return null;

    const { missing, warnings } = validateContentItemAgainstModel(contentItem.fields, model);
    const modelName = model.referenceName || definitionName;
    for (const warning of warnings) {
      logger.warning?.(`[${locale}] Content ${itemName} (contentID: ${contentItem.contentID}): ${warning}`);
    }
    if (missing.length === 0) return null;

    return {
      item: contentItem,
      error: `${formatMissingRequiredFields(modelName, missing)} — skipped client-side`,
      model: modelName,
      missing,
    };
  };

  // Route an item that would be written (create/update) either to processing or to failure.
  const queueForWrite = (contentItem: ContentItem, itemName: string, action: "create" | "update"): boolean => {
    const failure = validateForWrite(contentItem, itemName);
    if (failure) {
      itemsToFail.push(failure);
      invalidCount++;
      if (state.preflight) {
        // A real run would fail this item without sending it — warn, but don't count it as a write.
        console.warn(ansiColors.yellow(`⚠️  Content ${itemName} [${locale}] would be skipped: ${failure.error}`));
      }
      preflightReport.record({
        phase: "Content",
        action: "invalid",
        name: itemName,
        locale,
        detail: `would ${action} but ${failure.error}`,
      });
      return false;
    }
    itemsToProcess.push(contentItem);
    preflightReport.record({ phase: "Content", action, name: itemName, locale });
    return true;
  };

  // Track decision stats for summary logging
  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let conflictCount = 0;
  let invalidCount = 0;

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
        // Content doesn't exist - include it for creation (unless it fails model validation)
        if (queueForWrite(contentItem, itemName, "create")) createCount++;
      } else if (shouldUpdate) {
        // Content exists but needs updating (unless it fails model validation)
        if (queueForWrite(contentItem, itemName, "update")) updateCount++;
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
        `[FilterContent] Decision summary: ${createCount} create, ${updateCount} update, ${skipCount} skip, ${conflictCount} conflict, ${invalidCount} invalid`
      )
    );
  }

  return {
    itemsToProcess,
    itemsToSkip,
    skippedCount: itemsToSkip.length,
    itemsToFail,
  };
}
