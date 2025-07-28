import ansiColors from "ansi-colors";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { findContentInTargetInstance } from "./find-content-in-target-instance";
import { ApiClient, ContentItem } from "@agility/management-sdk";
import { Logs } from "core/logs";
import { state } from "core";

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

	for (const contentItem of contentItems) {
		const itemName = contentItem.properties.referenceName || "Unknown";

		try {
			const findResult = findContentInTargetInstance({
				sourceContent: contentItem,
				referenceMapper
			});

			const { content, shouldUpdate, shouldCreate, shouldSkip, isConflict, reason } = findResult;
			if (isConflict) {
				///CONFLICT DETECTED
				logger.content.error(contentItem, `!! Conflict detected for content ${itemName}: ${reason}`, locale, state.targetGuid[0]);
				itemsToSkip.push(contentItem);
				continue;
			} else if (shouldCreate) {
				// Content doesn't exist - include it for creation
				itemsToProcess.push(contentItem);
			} else if (shouldUpdate) {
				// Content exists but needs updating
				itemsToProcess.push(contentItem);
			} else if (shouldSkip) {
				// Content exists and is up to date - skip
				logger.content.skipped(contentItem, "up to date, skipping", locale, state.targetGuid[0]);
				itemsToSkip.push(contentItem);
			}
		} catch (error: any) {
			// If we can't check, err on the side of processing it
			logger.content.error(contentItem, error.message, locale, state.targetGuid[0]);
			itemsToProcess.push(contentItem);
		}
	}

	return {
		itemsToProcess,
		itemsToSkip,
		skippedCount: itemsToSkip.length,
	};
}