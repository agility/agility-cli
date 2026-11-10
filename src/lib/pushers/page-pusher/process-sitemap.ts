import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { state, getApiClient, blockOtherLocaleStaging } from "../../../core/state";
import { FailureDetail, PusherResult } from "../../../types/sourceData";
import { SitemapHierarchy } from "./sitemap-hierarchy";
import { PageMapper } from "../../mappers/page-mapper";
import { processPage, parentNotOnTargetError } from "./process-page";
import { preflightReport } from "../../preflight/preflight-report";
import { SitemapNode } from "types/index";
import { LocalePageScope } from "types/pageScope";
import { Logs } from "core/logs";

interface ReturnType {
  successful: number;
  failed: number;
  skipped: number;
  publishableIds: number[];
  failureDetails: Array<{
    name: string;
    error: string;
    type?: "content" | "page";
    pageID?: number;
    contentID?: number;
    guid?: string;
    locale?: string;
  }>;
  // PROD-2316: non-blocking dropped-module notices collected from processPage results.
  warningDetails: FailureDetail[];
}

interface Props {
  channel: string;
  pageMapper: PageMapper;
  sitemapNodes: SitemapNode[];
  sourceGuid: string;
  targetGuid: string;
  locale: string;
  apiClient: mgmtApi.ApiClient;
  overwrite: boolean;
  sourcePages: mgmtApi.PageItem[];
  parentPageID: number;
  logger: Logs;
  /**
   * PROD-2546: when a --pages scope is active, restricts this walk to the selected pages and
   * their descendants. Omitted for a normal, unscoped sync.
   */
  pageScope?: LocalePageScope;
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
  logger,
  pageScope,
}: Props): Promise<ReturnType> {
  let returnData: ReturnType = {
    successful: 0,
    failed: 0,
    skipped: 0,
    publishableIds: [],
    failureDetails: [],
    warningDetails: [],
  };

  // Reverse the sitemap nodes to process them in the correct order
  const reversedNodes = [...sitemapNodes].reverse();

  let previousPageID = 0; // Store the previous page ID for ordering

  const mergeChildResults = (childRes: ReturnType): void => {
    returnData.successful += childRes.successful;
    returnData.failed += childRes.failed;
    returnData.skipped += childRes.skipped;
    returnData.publishableIds.push(...childRes.publishableIds);
    returnData.failureDetails.push(...childRes.failureDetails);
    returnData.warningDetails.push(...childRes.warningDetails);
  };

  // PROD-3113: the descendants of a page that isn't on the target are reported, not saved. Saved
  // with no target parent they'd land at the root, duplicating pages the target already has.
  // A parent in conflict (on the target at the same path, no mapping, no --overwrite) is a skip,
  // as is everything under it; any other missing parent is a failure.
  const blockDescendants = (
    nodes: SitemapNode[],
    ancestorID: number,
    ancestorName?: string,
    reason: "missing" | "conflict" | "preflightSkip" = "missing"
  ): void => {
    const ancestorInConflict = reason === "conflict";
    // In preflight a parent can be skipped only because preflight can't see what the run would
    // create first (e.g. a page template). Its children are previewed as skips, not failures.
    const error =
      reason === "preflightSkip"
        ? `skipped with its parent page "${ancestorName ?? `Page ${ancestorID}`}" (source page ${ancestorID}), which preflight skipped`
        : parentNotOnTargetError(ancestorID, ancestorName, ancestorInConflict);
    const visit = (children: SitemapNode[]): void => {
      for (const child of children || []) {
        if (!child) continue;
        const inScope = !pageScope || pageScope.pageIDs.has(child.pageID);
        if (inScope && !processedPageIDs.has(child.pageID)) {
          processedPageIDs.add(child.pageID);
          const sourcePage = sourcePages.find((page) => page.pageID === child.pageID);
          const name = sourcePage?.name || child.name || `Page ${child.pageID}`;
          if (reason !== "missing") {
            logger.page.skipped(sourcePage || child, error, locale, channel, targetGuid);
            preflightReport.record({
              phase: "Pages",
              action: ancestorInConflict ? "conflict" : "skip",
              name,
              locale,
              detail: error,
            });
            returnData.skipped++;
          } else {
            logger.page.error(sourcePage || child, `✗ Page "${name}" ${error}`, locale, channel, targetGuid);
            preflightReport.record({ phase: "Pages", action: "skip", name, locale, detail: error });
            returnData.failed++;
            returnData.failureDetails.push({
              name,
              error,
              type: "page",
              pageID: child.pageID,
              guid: sourceGuid,
              locale,
            });
          }
        }
        visit(child.children || []);
      }
    };
    visit(nodes);
  };

  // Whether a page's children can be saved under it: it has a mapping row (created, updated,
  // mapped with --overwrite, or already in sync), or, in preflight, which writes no mappings, it would have one.
  const isOnTarget = (pageID: number, res?: { status: string; adopted?: boolean }): boolean =>
    !!pageMapper.getPageMappingByPageID(pageID, "source") ||
    (!!state.preflight && !!res && (res.status === "success" || !!res.adopted));

  // Process each page in the reversed sitemap nodes
  for (const node of reversedNodes) {
    // PROD-2546: a --pages scope narrows this walk to the selected pages and everything
    // beneath them. An ancestor of a selection is still walked THROUGH — it is what supplies
    // the parentPageID its in-scope children are created under — but is never pushed itself.
    // Any other branch is skipped whole, since nothing under it can be in scope.
    if (pageScope && !pageScope.pageIDs.has(node.pageID)) {
      if (pageScope.traversePageIDs.has(node.pageID) && !isOnTarget(node.pageID)) {
        blockDescendants(node.children || [], node.pageID, node.name);
      } else if (pageScope.traversePageIDs.has(node.pageID)) {
        mergeChildResults(
          await processSitemap({
            channel,
            pageMapper,
            sitemapNodes: node.children || [],
            sourceGuid,
            targetGuid,
            locale,
            apiClient,
            overwrite,
            sourcePages,
            parentPageID: node.pageID,
            logger,
            pageScope,
          })
        );
      }

      // A skipped sibling is still a valid anchor for placing a NEW page in the right spot,
      // so the ordering cursor advances whether or not the page itself was pushed.
      previousPageID = node.pageID;
      continue;
    }

    //process the page for this node...
    const sourcePage = sourcePages.find((page) => page.pageID === node.pageID);

    if (!sourcePage) {
      const errorMsg = `source page with ID ${node.pageID} not found in source data.`;
      logger.page.error(node, errorMsg, locale, channel, targetGuid);
      returnData.failed++;
      returnData.failureDetails.push({
        name: `PageID ${node.pageID}`,
        error: errorMsg,
        type: "page",
        pageID: node.pageID,
        guid: sourceGuid,
        locale,
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
      logger,
    });

    // PROD-2316: collect dropped-module notices regardless of the page's final status.
    if (pageRes.warnings && pageRes.warnings.length > 0) {
      returnData.warningDetails.push(...pageRes.warnings);
    }

    if (pageRes.status === "success") {
      returnData.successful++;

      // Only add to publishableIds if source page is in Published state (state === 2)
      // Staging pages (state === 1) should not be auto-published
      const isSourcePublished = sourcePage.properties?.state === 2;
      if (isSourcePublished) {
        const mapping = pageMapper.getPageMappingByPageID(sourcePage.pageID, "source");
        if (mapping) {
          returnData.publishableIds.push(mapping.targetPageID);
        }
      } else if (state.autoPublish) {
        console.log(
          ansiColors.gray(
            `    📋 Skipping auto-publish for page "${sourcePage.name}" (state: ${sourcePage.properties?.state} - not published in source)`
          )
        );
      }
    } else if (pageRes.status === "skip") {
      returnData.skipped++;
    } else {
      // pageRes.status is "failure"
      returnData.failed++;
      // PROD-2782: a save in another locale may queue this page for republishing in this locale
      // (before or after this point in the run). Its own save here failed, so leave it in staging.
      const failedMapping = pageMapper.getPageMappingByPageID(sourcePage.pageID, "source");
      if (failedMapping) {
        blockOtherLocaleStaging(locale, failedMapping.targetPageID);
      }
      returnData.failureDetails.push({
        name: sourcePage.name || `Page ${sourcePage.pageID}`,
        error: pageRes.error || "Unknown error",
        type: "page",
        pageID: sourcePage.pageID,
        contentID: pageRes.contentID, // Include contentID for linking to the missing content
        guid: sourceGuid,
        locale,
      });
    }

    if (!isOnTarget(sourcePage.pageID, pageRes)) {
      blockDescendants(
        node.children || [],
        sourcePage.pageID,
        sourcePage.name,
        pageRes.conflict ? "conflict" : state.preflight && pageRes.status === "skip" ? "preflightSkip" : "missing"
      );
      previousPageID = node.pageID;
      continue;
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
      logger,
      pageScope,
    });

    // Update returnData based on childRes
    mergeChildResults(childRes);

    // Update previousPageID for next iteration
    previousPageID = node.pageID;
  }

  // Deduplicate publishableIds at the sitemap level to prevent duplicates from recursive calls
  returnData.publishableIds = Array.from(new Set(returnData.publishableIds));

  return returnData;
}
