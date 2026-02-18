import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { state, getApiClient } from "../../../core/state";
import { PusherResult } from "../../../types/sourceData";
import { SitemapHierarchy } from "./sitemap-hierarchy";
import { PageMapper } from "../../mappers/page-mapper";
import { processPage } from "./process-page";
import { SitemapNode } from "types/index";
import { Logs } from "core/logs";

interface ReturnType {
	successful: number;
	failed: number;
	skipped: number;
	publishableIds: number[];
	failureDetails: Array<{ name: string; error: string; type?: 'content' | 'page'; pageID?: number; contentID?: number; guid?: string; locale?: string }>;
}

interface Props {
	channel: string,
	pageMapper: PageMapper,
	sitemapNodes: SitemapNode[],
	sourceGuid: string,
	targetGuid: string,
	locale: string,
	apiClient: mgmtApi.ApiClient,
	overwrite: boolean,
	sourcePages: mgmtApi.PageItem[],
	parentPageID: number,
	logger: Logs
}

/**
 * We need to process each page in the sitemap nodes recursively IN REVERSE ORDER to get the hierarchy and the ordering correct.
 * @param param0
 */
// Track pages processed in the current sitemap processing session to prevent duplicate processing
// This is separate from pagesInProgress which tracks concurrent processing
const processedPageIDs = new Set<number>();

/**
 * Reset the processed page IDs tracking - should be called at the start of each pushPages operation
 */
export function resetProcessedPageIDs(): void {
	processedPageIDs.clear();
}

export async function processSitemap({
	channel,
	pageMapper,
	sitemapNodes,
	sourceGuid,
	targetGuid,
	locale,
	apiClient,
	overwrite,
	sourcePages,
	parentPageID,
	logger
}: Props): Promise<ReturnType> {

	let returnData: ReturnType = {
		successful: 0,
		failed: 0,
		skipped: 0,
		publishableIds: [],
		failureDetails: []
	};

	// Reverse the sitemap nodes to process them in the correct order
	const reversedNodes = [...sitemapNodes].reverse();

	let previousPageID = 0; // Store the previous page ID for ordering

	// Process each page in the reversed sitemap nodes
	for (const node of reversedNodes) {

		//process the page for this node...
		const sourcePage = sourcePages.find(page => page.pageID === node.pageID);

		if (!sourcePage) {
			const errorMsg = `source page with ID ${node.pageID} not found in source data.`;
			logger.page.error(node, errorMsg, locale, channel, targetGuid);
			returnData.failed++;
			returnData.failureDetails.push({ 
				name: `PageID ${node.pageID}`, 
				error: errorMsg,
				type: 'page',
				pageID: node.pageID,
				guid: sourceGuid,
				locale
			});
			continue; // Skip if source page is missing
		}

		// CRITICAL: Check if we've already processed this pageID in this sitemap session
		// Dynamic pages can appear multiple times in the sitemap with the same pageID but different contentIDs
		// We only want to process the page definition once, not create it multiple times
		if (processedPageIDs.has(sourcePage.pageID)) {
			// Silently skip - don't count as skipped, just continue
			continue;
		}

		// Mark this pageID as processed
		processedPageIDs.add(sourcePage.pageID);

		const pageRes = await processPage({
			apiClient,
			channel,
			page: sourcePage,
			sourceGuid,
			targetGuid,
			locale,
			overwrite,
			insertBeforePageId: previousPageID,
			pageMapper,
			parentPageID,
			logger
		})

		if (pageRes.status === "success") {
			returnData.successful++;

			// Only add to publishableIds if source page is in Published state (state === 2)
			// Staging pages (state === 1) should not be auto-published
			const isSourcePublished = sourcePage.properties?.state === 2;
			if (isSourcePublished) {
				const mapping = pageMapper.getPageMappingByPageID(sourcePage.pageID, 'source');
				if (mapping) {
					returnData.publishableIds.push(mapping.targetPageID);
				}
			} else {
				console.log(ansiColors.gray(`    📋 Skipping auto-publish for page "${sourcePage.name}" (state: ${sourcePage.properties?.state} - not published in source)`));
			}

		} else if (pageRes.status === "skip") {
			returnData.skipped++;
		} else {
			// pageRes.status is "failure"
			returnData.failed++;
			returnData.failureDetails.push({ 
				name: sourcePage.name || `Page ${sourcePage.pageID}`, 
				error: pageRes.error || 'Unknown error',
				type: 'page',
				pageID: sourcePage.pageID,
				contentID: pageRes.contentID,  // Include contentID for linking to the missing content
				guid: sourceGuid,
				locale
			});
		}


		//process the children of this node...
		const childRes = await processSitemap({
			channel,
			pageMapper,
			sitemapNodes: node.children || [],
			sourceGuid,
			targetGuid,
			locale,
			apiClient,
			overwrite,
			sourcePages,
			// Pass current node's page ID as parent for children
			parentPageID: node.pageID,
			logger
		})

		// Update returnData based on childRes
		returnData.successful += childRes.successful;
		returnData.failed += childRes.failed;
		returnData.skipped += childRes.skipped;
		returnData.publishableIds.push(...childRes.publishableIds);
		returnData.failureDetails.push(...childRes.failureDetails);

		// Update previousPageID for next iteration
		previousPageID = node.pageID;


	}
	
	// Deduplicate publishableIds at the sitemap level to prevent duplicates from recursive calls
	returnData.publishableIds = Array.from(new Set(returnData.publishableIds));
	
	return returnData;
}