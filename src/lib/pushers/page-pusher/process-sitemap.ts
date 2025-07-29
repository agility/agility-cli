import * as mgmtApi from "@agility/management-sdk";
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
	publishableIds: number[]
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
		publishableIds: []
	};

	// Reverse the sitemap nodes to process them in the correct order
	const reversedNodes = [...sitemapNodes].reverse();

	let previousPageID = 0; // Store the previous page ID for ordering

	// Process each page in the reversed sitemap nodes
	for (const node of reversedNodes) {

		//process the page for this node...
		const sourcePage = sourcePages.find(page => page.pageID === node.pageID);

		if (!sourcePage) {
			logger.page.error(node, `source page with ID ${node.pageID} not found in source data.`, locale, channel, targetGuid);
			returnData.failed++;
			continue; // Skip if source page is missing
		}

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

		if (pageRes === "success") {
			returnData.successful++;

			const mapping = pageMapper.getPageMappingByPageID(sourcePage.pageID, 'source');
			if (mapping) {
				returnData.publishableIds.push(mapping.targetPageID);
			}

		} else if (pageRes === "skip") {
			returnData.skipped++;
		} else {
			returnData.failed++;
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

		// Update previousPageID for next iteration
		previousPageID = node.pageID;


	}
	return returnData;
}