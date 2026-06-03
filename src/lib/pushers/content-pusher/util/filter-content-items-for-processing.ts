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
				referenceMapper
			});

			const { content, shouldUpdate, shouldCreate, shouldSkip, isConflict, reason } = findResult;
			if (isConflict) {
				// CONFLICT DETECTED - log warning and skip
				console.warn(
					`⚠️  Conflict detected content ${ansiColors.underline(itemName)} ${ansiColors.bold.grey("changes detected in both source and target")}. Please resolve manually.`
				);
				if (reason) {
					console.warn(`   ${reason}`);
				}
				itemsToSkip.push(contentItem);
				conflictCount++;
				continue;
			} else if (shouldCreate) {
				// Content doesn't exist - include it for creation
				itemsToProcess.push(contentItem);
				createCount++;
			} else if (shouldUpdate) {
				// Content exists but needs updating
				itemsToProcess.push(contentItem);
				updateCount++;
			} else if (shouldSkip) {
				// Content exists and is up to date - skip
				logger.content.skipped(contentItem, "up to date, skipping", locale, targetGuid);
				itemsToSkip.push(contentItem);
				skipCount++;
			}
		} catch (error: any) {
			// If we can't check, err on the side of processing it
			logger.content.error(contentItem, error.message, locale, targetGuid);
			itemsToProcess.push(contentItem);
		}
	}

	// Log decision summary if verbose
	if (state.verbose && contentItems.length > 0) {
		console.log(ansiColors.gray(`[FilterContent] Decision summary: ${createCount} create, ${updateCount} update, ${skipCount} skip, ${conflictCount} conflict`));
	}

	return {
		itemsToProcess,
		itemsToSkip,
		skippedCount: itemsToSkip.length,
	};
}