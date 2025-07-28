import * as mgmtApi from "@agility/management-sdk";
import { state, getApiClient, getLoggerForGuid } from "core/state";
import { PusherResult } from "../../../types/sourceData";
import { SitemapHierarchy } from "lib/pushers/page-pusher/sitemap-hierarchy";
import { PageMapper } from "lib/mappers/page-mapper";
import { processSitemap } from "./process-sitemap";
import ansiColors from "ansi-colors";

export async function pushPages(
	sourceData: mgmtApi.PageItem[],
	locale: string
): Promise<PusherResult> {
	// Extract data from sourceData - unified parameter pattern
	let pages: mgmtApi.PageItem[] = sourceData || [];

	const { sourceGuid, targetGuid } = state;
	const logger = getLoggerForGuid(sourceGuid[0]);
	const pageMapper = new PageMapper(sourceGuid[0], targetGuid[0], locale);

	if (!pages || pages.length === 0) {
		console.log("No pages found to process.");
		return { status: "success", successful: 0, failed: 0, skipped: 0 };
	}

	const sitemapHierarchy = new SitemapHierarchy();

	const sitemaps = sitemapHierarchy.loadAllSitemaps(sourceGuid[0], locale);
	const channels = Object.keys(sitemaps);

	console.log(`Processing ${pages.length} pages across ${channels.length} channels in ${locale}...`);

	let successful = 0;
	let failed = 0;
	let skipped = 0; // No duplicates to skip since API prevents true duplicates at same hierarchy level
	let status: "success" | "error" = "success";
	let publishableIds: number[] = []; // Track target page IDs for auto-publishing


	//loop all the channels
	for (const channel of channels) {
		const sitemap = sitemaps[channel];

		const { sourceGuid, targetGuid, overwrite } = state;
		const apiClient = getApiClient();

		try {
			const res = await processSitemap({
				channel,
				pageMapper,
				sitemapNodes: sitemap,
				sourceGuid: sourceGuid[0],
				targetGuid: targetGuid[0],
				locale: locale,
				apiClient,
				overwrite,
				sourcePages: pages,
				// Top-level pages have no parent
				parentPageID: -1,
				logger
			})

			successful = res.successful;
			failed = res.failed;
			skipped = res.skipped;
			publishableIds = res.publishableIds;

			if (failed > 0) {
				status = "error";
			}

		} catch (error) {
			logger.page.error(null,`⚠️ Error in page processing for channel: ${channel}: ${JSON.stringify(error, null, 2)}`, locale);
			status = "error";
		}

	}

	return { status, successful, failed, skipped, publishableIds };
}
