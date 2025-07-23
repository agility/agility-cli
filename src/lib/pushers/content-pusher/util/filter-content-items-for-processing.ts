import ansiColors from "ansi-colors";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { findContentInTargetInstance } from "./find-content-in-target-instance";
import { ApiClient, ContentItem } from "@agility/management-sdk";

/**
 * Filter content items for processing
 * Moved from orchestrate-pushers.ts for better separation of concerns
 */
export interface ContentFilterResult {
	itemsToCreate: any[];
	itemsToUpdate: any[];
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
}

export async function filterContentItemsForProcessing({
	contentItems,
	apiClient,
	targetGuid,
	locale,
	referenceMapper,
	targetData = [],
}: FilterProp): Promise<ContentFilterResult> {
	const itemsToCreate: any[] = [];
	const itemsToUpdate: any[] = [];
	const itemsToSkip: any[] = [];

	for (const contentItem of contentItems) {
		const itemName = contentItem.properties.referenceName || "Unknown";

		try {
			const findResult = findContentInTargetInstance({
				sourceContent: contentItem,
				referenceMapper
			});


			const { content, shouldUpdate, shouldCreate, shouldSkip } = findResult;

			if (shouldCreate) {
				// Content doesn't exist - include it for creation
				itemsToCreate.push(contentItem);
			} else if (shouldUpdate) {
				// Content exists but needs updating
				itemsToUpdate.push(contentItem);
				console.log(
					`✓ Content ${ansiColors.cyan.underline(itemName)} vID:${ansiColors.bold.yellow(
						"needs update"
					)} vID:${ansiColors.bold.green(content?.properties?.versionID.toString())} → ${ansiColors.bold.green(
						contentItem.properties?.versionID.toString()
					)} - ${ansiColors.green(targetGuid)}: ID:${content?.contentID}`
				);
			} else if (shouldSkip) {
				// Content exists and is up to date - skip
				console.log(
					`✓ Content ${ansiColors.cyan.underline(itemName)} ${ansiColors.bold.gray(
						"up to date, skipping"
					)}`
				);
				itemsToSkip.push(contentItem);
			}
		} catch (error: any) {
			// If we can't check, err on the side of processing it
			console.warn(`⚠️ Could not check if content ${itemName} exists: ${error.message} - will process`);
			itemsToCreate.push(contentItem);
		}
	}

	return {
		itemsToCreate,
		itemsToUpdate,
		itemsToSkip,
		skippedCount: itemsToSkip.length,
	};
}