import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { PageMapper } from "../../mappers/page-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { TemplateMapper } from "lib/mappers/template-mapper"; // Internal helper function to process a single page
import { SectionMapper } from "lib/mappers/section-mapper";
import { translateZoneNames } from "./translate-zone-names";
import { findPageInOtherLocale, OtherLocaleMapping } from "./find-page-in-other-locale";
import { refreshOtherLocaleVersions } from "./refresh-other-locale-versions";
import { Logs } from "core/logs";
import {
  state,
  getFailedContent,
  getHeldBackTemplate,
  contentExistsInSourceData,
  contentExistsInOtherLocale,
} from "core/state";
import { FailureDetail, PageModuleExtended } from "types/sourceData";
import { preflightReport } from "../../preflight/preflight-report";
import { keptTargetChanges } from "../kept-target-changes";
import { fileOperations } from "../../../core";
import {
  findSameNamedTargetPage,
  pageTypesDiffer,
  sitemapTypeLabel,
  TargetPageCandidate,
} from "./find-same-named-target-page";

interface Props {
  channel: string;
  page: mgmtApi.PageItem;
  sourceGuid: string;
  targetGuid: string;
  locale: string;
  apiClient: mgmtApi.ApiClient;
  overwrite: boolean;
  insertBeforePageId: number | null;
  pageMapper: PageMapper;
  parentPageID: number;
  logger: Logs;
}

export type PageProcessResult = {
  status: "success" | "skip" | "failure";
  error?: string;
  contentID?: number;
  // PROD-2316: non-blocking notices for modules dropped from this page because their content
  // couldn't be resolved on the target. The page itself still pushes.
  warnings?: FailureDetail[];
  // PROD-3113: preflight only: the page would be mapped to the target page already at its path
  // and updated (--overwrite), so its child pages will have somewhere to go.
  adopted?: boolean;
  // PROD-3113: the target already has a page at this path with no mapping, and --overwrite wasn't
  // set. Nothing was written; the page's children are skipped with it.
  conflict?: boolean;
};

/**
 * PROD-3113: in preflight, the target page each source page would be mapped to under --overwrite.
 * Preflight writes no mapping rows, so without this a child of such a page would find no target
 * parent, and be planned as a create instead of being mapped to the target page under it.
 */
const plannedTargetPageIDs = new Map<number, number>();

/** Clear the preflight's planned mappings; called at the start of each locale's page push. */
export function resetPlannedPageMappings(): void {
  plannedTargetPageIDs.clear();
}

export async function processPage({
  channel,
  page,
  sourceGuid,
  targetGuid,
  locale,
  apiClient,
  overwrite = false,
  insertBeforePageId = null,
  pageMapper,
  parentPageID,
  logger,
}: Props): Promise<PageProcessResult> {
  // Returns object with status and optional error message

  let existingPage: mgmtApi.PageItem | null = null;
  let channelID = -1;

  const templateMapper = new TemplateMapper(sourceGuid, targetGuid);

  try {
    let targetTemplate: mgmtApi.PageModel | null = null;
    let sourceTemplate: mgmtApi.PageModel | null = null;
    // Only try to find template mapping for non-folder pages
    if (page.pageType !== "folder" && page.templateName) {
      // Find the template mapping
      let templateRef = templateMapper.getTemplateMappingByPageTemplateName(page.templateName, "source");
      if (!templateRef) {
        logger.page.skipped(
          page,
          `Missing page template ${page.templateName} in source data, skipping`,
          locale,
          channel,
          targetGuid
        );
        preflightReport.record({
          phase: "Pages",
          action: "skip",
          name: page.name,
          locale,
          detail: `missing page template ${page.templateName}`,
        });
        return { status: "skip" };
      }
      // The template pusher held this page's template back, and --overwrite was not set: its mapped
      // target template is gone (PROD-2603), so saving would point the page at a dead ID; or the
      // target's template was left as it is (a kept change or a conflict, PROD-3078) without a
      // section for one of the source's zones. Skip it; the reason says why.
      const heldBackReason = getHeldBackTemplate(page.templateName);
      if (heldBackReason) {
        const detail = heldBackReason;
        logger.page.skipped(page, `${detail}, skipping`, locale, channel, targetGuid);
        preflightReport.record({ phase: "Pages", action: "skip", name: page.name, locale, detail });
        return { status: "skip" };
      }
      targetTemplate = templateMapper.getMappedEntity(templateRef, "target") as mgmtApi.PageModel;
      // PROD-2350: needed alongside targetTemplate so translateZoneNames can resolve each zone's
      // current pageItemTemplateID on the source side before translating it through SectionMapper.
      sourceTemplate = templateMapper.getMappedEntity(templateRef, "source") as mgmtApi.PageModel;
    }

    // Get channel ID from target instance sitemap (not from existing page which may be invalid)
    const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);

    //TODO: this is NOT using the channel reference name properly since we don't get that from the mgmt api
    //TODO: we need to add the channel reference name to the mgmt API for a proper lookup here..
    const websiteChannel = sitemap?.find((channelObj) => channelObj.name?.toLowerCase() === channel.toLowerCase());
    const targetChannel = websiteChannel || sitemap?.[0];
    if (websiteChannel) {
      channelID = websiteChannel.digitalChannelID;
    } else {
      channelID = sitemap?.[0]?.digitalChannelID || 1; // Fallback to first channel or default
    }

    // PROD-3113: the target page this page goes under. A source parent with no mapping row means
    // the parent was never created or adopted on the target (it failed, or was skipped). Saving
    // this page anyway would put it at the root - a duplicate when the target already has it
    // under the right parent. Preflight never writes mappings, so a parent it plans to create
    // has none yet; that's expected there.
    let targetParentPageID = -1;
    if (parentPageID && parentPageID > 0) {
      const parentMapping = pageMapper.getPageMappingByPageID(parentPageID, "source");
      const plannedParentID = state.preflight ? plannedTargetPageIDs.get(parentPageID) : undefined;
      if ((parentMapping?.targetPageID || 0) > 0) {
        targetParentPageID = parentMapping.targetPageID;
      } else if (plannedParentID) {
        targetParentPageID = plannedParentID;
      } else if (!state.preflight) {
        const error = parentNotOnTargetError(parentPageID);
        logger.page.error(page, `✗ Page "${page.name}" ${error}`, locale, channel, targetGuid);
        return { status: "failure", error };
      }
    }

    //get the existing page from the target instance
    let pageMapping = pageMapper.getPageMapping(page, "source");
    existingPage = pageMapper.getMappedEntity(pageMapping, "target");

    // PROD-3113 / PROD-3026: no mapping row, but the target already has a page at this path (made
    // by hand, or by a sync whose mappings were lost). Creating it would fail on the server's
    // same-name check. It's a conflict: reported and left alone, or with --overwrite mapped and
    // updated in place. Under a parent preflight plans to create, there's nothing on the target.
    const parentExistsOnTarget = !(parentPageID > 0) || targetParentPageID > 0;
    if (!pageMapping && parentExistsOnTarget) {
      const candidate = findSameNamedTargetPage(targetChannel?.pages as any, targetParentPageID, page.name);
      if (candidate) {
        const adoption = await adoptTargetPage({
          page,
          candidate,
          apiClient,
          pageMapper,
          targetGuid,
          locale,
          channel,
          overwrite,
          logger,
        });
        if (adoption.result) return adoption.result;
        // --overwrite: carry on and update the adopted page from the source
        existingPage = adoption.targetPage;
        pageMapping = pageMapper.getPageMapping(page, "source");
      }
    }

    let mappingToOtherLocale: OtherLocaleMapping | null = null;

    if (!existingPage) {
      //check the other locales to see if this page has been mapped in another locale
      mappingToOtherLocale = await findPageInOtherLocale({
        sourcePageID: page.pageID,
        locale,
        sourceGuid,
        targetGuid,
      });
    }

    const hasSourceChanged = pageMapper.hasSourceChanged(page);
    const hasTargetChanged = pageMapper.hasTargetChanged(existingPage, pageMapping);

    // The target changed since the last sync. With the source changed too (or the target page
    // missing from the pull, so its state can't be checked) it's a conflict. With the source
    // unchanged, the target's version is kept with a warning (see kept-target-changes.ts); the
    // mapping isn't refreshed, so a later source change is still caught as a conflict.
    // --overwrite replaces either with the source.
    const isKeptTargetChange = hasTargetChanged !== null && hasTargetChanged !== "file_missing" && !hasSourceChanged;
    const isConflict = hasTargetChanged !== null && !isKeptTargetChange;
    const updateRequired = (hasSourceChanged && !isConflict) || (overwrite && hasTargetChanged !== null);
    const createRequired = !existingPage;

    const pageTypeDisplay =
      {
        static: "Page",
        link: "Link",
        folder: "Folder",
      }[page.pageType] || page.pageType;

    if (isKeptTargetChange && !overwrite) {
      const targetPageID = existingPage?.pageID ?? pageMapping?.targetPageID;
      const change = {
        type: "page" as const,
        name: page.name,
        locale,
        sourceID: page.pageID,
        targetID: targetPageID,
        targetUrl: targetPageID
          ? `https://app.agilitycms.com/instance/${targetGuid}/${locale}/pages/${targetPageID}`
          : undefined,
      };
      keptTargetChanges.record(change);
      console.warn(ansiColors.yellow(keptTargetChanges.formatLine(change)));
      preflightReport.record({
        phase: "Pages",
        action: "skip",
        name: page.name,
        locale,
        detail: "target changed since the last sync and the source didn't; kept the target's version",
      });
      return { status: "skip" }; // Keep the target's page; don't auto-publish it either
    } else if (isConflict && !overwrite) {
      // CONFLICT: Target has independent changes.
      // Use mapping's targetPageID as fallback in case existingPage wasn't loaded.
      const targetPageID = existingPage?.pageID ?? pageMapping?.targetPageID;
      const sourceUrl = `https://app.agilitycms.com/instance/${sourceGuid}/${locale}/pages/${page.pageID}`;
      const targetUrl = `https://app.agilitycms.com/instance/${targetGuid}/${locale}/pages/${targetPageID}`;

      let reason: string;
      if (hasTargetChanged === "file_missing") {
        reason = "target page may have been unpublished or deleted — cannot verify its current state";
      } else {
        reason = "changes detected in both source and target";
      }

      console.warn(
        `⚠️  Conflict detected ${pageTypeDisplay} ${ansiColors.underline(page.name)} — ${ansiColors.bold.grey(reason)}. Use --overwrite to force.`
      );
      console.warn(`   - Source: ${sourceUrl}`);
      console.warn(`   - Target: ${targetUrl}`);

      if (!overwrite) {
        preflightReport.record({ phase: "Pages", action: "conflict", name: page.name, locale, detail: reason });
        return { status: "skip" }; // Prevent conflicting pages from being processed and auto-published
      }
      // overwrite mode: warn but continue processing
    } else if (createRequired) {
      //CREATE NEW PAGE - nothing to do here yet...
    } else if (!updateRequired) {
      // PROD-2628: existingPage is the target page as pulled at the start of the run. If a save
      // of this page in another locale earlier in this run already moved the record's target
      // version forward (refreshOtherLocaleVersions), rewriting it from the pulled page would put
      // the stale version back and the next run would read our own write as a target change.
      const wouldRegress =
        !!existingPage &&
        !!pageMapping &&
        (existingPage.properties?.versionID ?? 0) < (pageMapping.targetVersionID ?? 0);
      if (existingPage && !wouldRegress) {
        pageMapper.addMapping(page, existingPage);
      }

      logger.page.skipped(page, "up to date, skipping", locale, channel, targetGuid);
      preflightReport.record({ phase: "Pages", action: "skip", name: page.name, locale, detail: "up to date" });
      return { status: "skip" }; // Skip processing - page already exists
    }

    // Preflight (PROD-2203): we've decided this page would be created or updated.
    // Record the planned action and skip the actual write to the target.
    if (state.preflight) {
      // PROD-2542: content the content phase would fail (e.g. skipped for a missing required field)
      // is in the failed-content registry; a real run drops the modules that point at it.
      const wouldDrop = countModulesReferencingFailedContent(page, locale);
      preflightReport.record({
        phase: "Pages",
        action: createRequired ? "create" : "update",
        name: page.name,
        locale,
        ...(wouldDrop > 0 ? { detail: `${wouldDrop} component(s) would be dropped (content would fail)` } : {}),
      });
      return { status: "success" };
    }

    // Map Content IDs in Zones
    // Handle folder pages which may not have zones
    let sourceZones = page.zones ? { ...page.zones } : {}; // Clone zones or use empty object

    // CRITICAL: Translate zone names to match template expectations BEFORE content mapping
    const sectionMapper = new SectionMapper(sourceGuid, targetGuid);
    let mappedZones = translateZoneNames(sourceZones, targetTemplate, { sourceTemplate, sectionMapper }) as {
      [key: string]: PageModuleExtended[];
    };

    const contentMapper = new ContentItemMapper(sourceGuid, targetGuid, locale);
    // PROD-2316: modules whose content can't be resolved are DROPPED from the pushed page rather
    // than failing the whole page. Collect every drop (not just the first) as a non-blocking
    // warning so the run summary can report exactly what was left out and why.
    const droppedModules: FailureDetail[] = [];

    for (const [zoneName, zoneModules] of Object.entries(mappedZones)) {
      const newZoneContent = [];
      if (Array.isArray(zoneModules)) {
        for (const module of zoneModules) {
          // Create copy of module to avoid modifying original
          const newModule = { ...module };

          // Check if module has content item reference
          if (module.item && typeof module.item === "object") {
            // CRITICAL FIX: Check both contentid (lowercase) and contentId (camelCase)
            // The page data contains "contentid" (lowercase) but code was checking "contentId"
            const sourceContentId = module.item.contentid || module.item.contentId;

            if (sourceContentId && sourceContentId > 0) {
              const contentMapping = contentMapper.getContentItemMappingByContentID(sourceContentId, "source");
              const targetContentID = contentMapping?.targetContentID;
              if (targetContentID) {
                // CRITICAL FIX: Map to target content ID and remove duplicate fields
                const targetContentId = targetContentID;
                newModule.item = {
                  ...module.item,
                  contentid: targetContentId, // Use target content ID only
                  fulllist: module.item.fulllist,
                };
                // Remove contentId field to avoid confusion
                delete newModule.item.contentId;
                newZoneContent.push(newModule);
              } else {
                // Content mapping failed - check why (in priority order)
                const failedContent = getFailedContent(sourceContentId, locale);
                const isPageUnpublished = page.properties?.state !== 2;
                const existsInSource = contentExistsInSourceData(sourceGuid, locale, sourceContentId);
                const otherLocale = !existsInSource
                  ? contentExistsInOtherLocale(sourceGuid, locale, sourceContentId)
                  : null;
                let mappingError: string;

                if (failedContent) {
                  // Content failed earlier - show the upstream error
                  mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content '${failedContent.referenceName}' failed earlier: ${failedContent.error}`;
                } else if (isPageUnpublished) {
                  // Page is unpublished - explains why content isn't in source (it wasn't pulled)
                  mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - page is unpublished and referenced content may not have been pulled`;
                } else if (otherLocale) {
                  // Content exists in another locale but not this one - not initialized for this locale
                  mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content not initialized in ${locale} (exists in ${otherLocale})`;
                } else if (!existsInSource) {
                  // Published page but content file doesn't exist anywhere - needs re-pull
                  mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content item not found in source data (may need to re-pull)`;
                } else {
                  // Content exists but wasn't synced - may be model issue
                  mappingError = `No content mapping for ${module.module} (contentID ${sourceContentId}) - content has never been synced or model may have changed`;
                }

                // PROD-2316: drop this module from the pushed page (it is NOT added to
                // newZoneContent) and record a non-blocking warning. The rest of the page still
                // pushes. NOTE: the server's SavePage diff (BatchInsertPageItem's toBeDeletedList)
                // REMOVES payload-absent modules from an existing target page, so a dropped module
                // is genuinely removed on the target — the mapping below is therefore recorded as
                // dirty (sourceVersionID 0) so the page re-pushes each sync and the module is
                // restored automatically once its content becomes resolvable.
                droppedModules.push({
                  name: page.name || `Page ${page.pageID}`,
                  error: `Dropped Component ${module.module} — ${mappingError}`,
                  type: "page",
                  pageID: page.pageID,
                  contentID: sourceContentId,
                  guid: sourceGuid,
                  locale,
                });
                logger.page.skipped(
                  page,
                  `dropped Component ${module.module} (contentID ${sourceContentId}) — ${mappingError}`,
                  locale,
                  channel,
                  targetGuid
                );
              }
            } else {
              // Module without content reference - keep it
              newZoneContent.push(newModule);
            }
          } else {
            // Module without content reference - keep it
            newZoneContent.push(newModule);
          }
        }
      }
      mappedZones[zoneName] = newZoneContent;
    }

    // PROD-2316: the hard-fail that previously aborted the whole page here whenever ANY module's
    // content mapping was missing has been removed. Unresolvable modules are dropped above (with
    // per-module warnings in `droppedModules`); the page itself still pushes with the modules
    // that DID resolve.

    // Check if page has any content left after filtering
    const totalModules = Object.values(mappedZones).reduce((sum: number, zone) => {
      return sum + (Array.isArray(zone) ? zone.length : 0);
    }, 0);

    // Helper function to check if a page legitimately can have no modules
    const isLegitimateEmptyPage = (page: mgmtApi.PageItem): boolean => {
      // Folder pages don't have content modules
      if (page.pageType === "folder") return true;

      // Link pages don't have content modules - they redirect to other URLs/pages/files
      if (page.pageType === "link") return true;

      // Dynamic pages don't have modules in zones - their content comes from dynamic containers
      // Check for dynamic page indicators
      const pageAny = page as any;
      if (pageAny.dynamic && pageAny.dynamic.referenceName) return true;
      if (pageAny.dynamicPageContentViewReferenceName) return true;

      // Pages with redirect URLs are link pages (even if pageType isn't explicitly 'link')
      // Check for common redirect URL properties (using 'any' type to access properties safely)
      if (pageAny.redirectUrl && pageAny.redirectUrl.trim()) return true;
      if (pageAny.redirect && pageAny.redirect.url && pageAny.redirect.url.trim()) return true;

      // Pages that link to files or other pages don't need modules
      // Using safe property access since these may not be in the type definition
      if (pageAny.linkToFileID && pageAny.linkToFileID > 0) return true;
      if (pageAny.linkToPageID && pageAny.linkToPageID > 0) return true;
      if (pageAny.linkToFile && pageAny.linkToFile > 0) return true;
      if (pageAny.linkToPage && pageAny.linkToPage > 0) return true;

      return false;
    };

    // Check if page has any content left after filtering
    if (totalModules === 0) {
      // Many pages legitimately have no modules (folder pages, link pages, etc.)
      // Only fail if this was a content page that had modules but lost them all during mapping
      const originalZones = page.zones || {};
      let originalModuleCount = 0;

      for (const [zoneName, zoneModules] of Object.entries(originalZones)) {
        if (Array.isArray(zoneModules)) {
          originalModuleCount += zoneModules.length;
        }
      }

      // If the page originally had modules but now has none, that's a problem
      // If it never had modules, that's fine (folder pages, etc.)
      // PROD-2316: this guard now also covers the UPDATE path (previously create-only). With
      // partial drops allowed, a page whose EVERY module failed to resolve signals a systemic
      // problem (e.g. the whole content phase failed) — pushing it would wipe all modules off the
      // existing target page. Genuine source-side emptiness is unaffected: if the author removed
      // every module in source, originalModuleCount is 0 and this never triggers.
      if (originalModuleCount > 0 && droppedModules.length > 0 && !isLegitimateEmptyPage(page)) {
        const lostModulesError = `Lost all ${originalModuleCount} Components during content mapping`;
        console.error(`✗ Page "${page.name}" ${lostModulesError}`);
        return {
          status: "failure",
          error: lostModulesError,
          contentID: droppedModules[0]?.contentID,
          warnings: droppedModules,
        };
      }
    }

    // Prepare payload - ensure proper null handling
    // Fix zones format - ensure zones is always a defined object (never null/undefined)
    const formattedZones = mappedZones && typeof mappedZones === "object" ? mappedZones : {};

    // Send the source title as-is. The Fetch API (Content Sync) returns an empty title as null, and
    // the Management API accepts a missing or empty title (folders ignore it), so null goes as "".
    // Filling in the menu text or page name made an untitled page - typically a dynamic page, whose
    // titles come from its titleFormula - differ from the source on every sync (PROD-3025, PROD-3043).
    const pageTitle = page.title ?? "";

    const pageJSON = JSON.stringify(page, null, 2);
    const pageCopy = JSON.parse(pageJSON) as mgmtApi.PageItem; // Create a copy to avoid modifying original

    const payload: any = {
      ...pageCopy,
      // If local target file is missing but mapping exists, use the known target container ID
      // to force an UPDATE instead of INSERT (prevents duplicate name server errors)
      pageID: existingPage ? existingPage.pageID : (pageMapping?.targetPageID ?? -1),
      title: pageTitle, // CRITICAL: Ensure title is always present
      channelID: channelID, // CRITICAL: Always use target instance channel ID to avoid FK constraint errors
      zones: formattedZones,
      // CRITICAL: Include path field from sitemap enrichment (API bug: target sitemap returns null paths)
      path: page.path || "",
    };

    // Resolved above; -1 only for a top-level page (an unmapped parent already returned a failure).
    const parentIDArg = targetParentPageID;
    payload.parentPageID = targetParentPageID;

    let placeBeforeIDArg = -1;
    // Only set placeBeforeIDArg for NEW pages, not updates
    // For updates, we preserve the existing position unless explicitly moving
    if (!existingPage && insertBeforePageId && insertBeforePageId > 0) {
      //map the insertBeforePageId to the correct target page ID
      const mapping = pageMapper.getPageMappingByPageID(insertBeforePageId, "source");
      if ((mapping?.targetPageID || 0) > 0) {
        placeBeforeIDArg = mapping.targetPageID;
      }
    }

    const pageIDInOtherLocale = mappingToOtherLocale ? mappingToOtherLocale.PageIDOtherLanguage : -1;
    const otherLocale = mappingToOtherLocale ? mappingToOtherLocale.OtherLanguageCode : null;

    // Save the page with returnBatchID flag for consistent batch processing
    const savePageResponse = await apiClient.pageMethods.savePage(
      payload,
      targetGuid,
      locale,
      parentIDArg,
      placeBeforeIDArg,
      true,
      pageIDInOtherLocale,
      otherLocale,
      true
    );

    // Process the response - with returnBatchID=true, we should always get a batch ID
    if (Array.isArray(savePageResponse) && savePageResponse.length > 0) {
      // Final content mapping summary for debugging
      const finalContentIds: number[] = [];
      Object.values(payload.zones || {}).forEach((zone: any) => {
        if (Array.isArray(zone)) {
          zone.forEach((module: any) => {
            if (module.item?.contentid) {
              finalContentIds.push(module.item.contentid);
            }
          });
        }
      });

      // Final payload prepared (silent)

      // Extract batch ID from response
      const batchID = savePageResponse[0];
      // Page batch processing started (silent)

      // Poll batch until completion using consistent utility (pass payload for error matching)
      const { pollBatchUntilComplete, extractPageBatchResults } = await import("../batch-polling");
      const completedBatch = await pollBatchUntilComplete(
        apiClient,
        batchID,
        targetGuid,
        [payload], // Pass payload for FIFO error matching
        300, // maxAttempts
        2000, // intervalMs
        "Page" // batchType
      );

      // Extract result from completed batch
      const { successfulItems: batchSuccessItems, failedItems: batchFailedItems } = extractPageBatchResults(
        completedBatch,
        [page]
      );

      let actualPageID = -1;
      let savedPageVersionID = -1;
      if (batchSuccessItems.length > 0) {
        //grab the save page info form the batch success items
        actualPageID = batchSuccessItems[0].newId;
        savedPageVersionID = batchSuccessItems[0].newItem?.processedItemVersionID || -1;
      } else if (batchFailedItems.length > 0) {
        logger.page.error(
          page,
          `✗ Page ${page.name} batch failed: ${batchFailedItems[0].error}`,
          locale,
          channel,
          targetGuid
        );
      }

      if (actualPageID > 0) {
        // Success case
        const createdPageData = {
          ...payload, // Use the payload data which has mapped zones
          pageID: actualPageID,
        } as mgmtApi.PageItem;

        if (savedPageVersionID > 0) {
          // Set version ID if available
          createdPageData.properties.versionID = savedPageVersionID; // Set version ID from batch result
        }

        if (droppedModules.length > 0) {
          // PROD-2316: modules were dropped, so record the mapping with sourceVersionID 0
          // ("never cleanly synced"). hasSourceChanged() then stays true on every subsequent
          // sync, so the page keeps re-pushing until a push completes with no drops — which
          // restores the dropped modules automatically once their content becomes resolvable.
          // targetVersionID is still recorded accurately, so this never reads as a conflict.
          const dirtySourcePage = {
            ...page,
            properties: { ...page.properties, versionID: 0 },
          } as mgmtApi.PageItem;
          pageMapper.addMapping(dirtySourcePage, createdPageData);
        } else {
          pageMapper.addMapping(page, createdPageData); // Use original page for source key
        }

        // PROD-2628: this save may also have given the page a new version in its other locales;
        // move those locales' recorded target version forward so the next run doesn't read our
        // own write as an independent target change.
        await refreshOtherLocaleVersions({
          targetPageID: actualPageID,
          savedLocale: locale,
          locales: Array.isArray(state.locale) ? state.locale : [],
          sourceGuid,
          targetGuid,
          apiClient,
        });

        const pageTypeDisplay =
          {
            static: "Page",
            link: "Link",
            folder: "Folder",
          }[page.pageType] || page.pageType;

        if (existingPage || pageMapping) {
          logger.page.updated(page, "updated", locale, channel, targetGuid);
        } else {
          logger.page.created(page, "created", locale, channel, targetGuid);
        }
        // PROD-2316: surface any dropped-module notices alongside the success.
        return { status: "success", warnings: droppedModules.length > 0 ? droppedModules : undefined };
      } else {
        let errorMsg: string;
        if (batchFailedItems.length > 0 && batchFailedItems[0].error) {
          errorMsg = batchFailedItems[0].error;
        } else if (
          completedBatch.errorData &&
          typeof completedBatch.errorData === "string" &&
          !completedBatch.errorData.startsWith("{")
        ) {
          // Use errorData only if it's a simple string (not JSON)
          errorMsg = completedBatch.errorData.trim();
        } else {
          errorMsg = `Invalid page ID: ${actualPageID}`;
        }
        logger.page.error(
          page,
          `✗ Page "${page.name}" failed - ${errorMsg}, locale:${locale}`,
          locale,
          channel,
          targetGuid
        );
        return { status: "failure", error: errorMsg, warnings: droppedModules.length > 0 ? droppedModules : undefined };
      }
    } else {
      const errorMsg = "Unexpected response format";
      logger.page.error(
        page,
        `✗ Page "${page.name}" failed in locale:${locale} - ${errorMsg}`,
        locale,
        channel,
        targetGuid
      );
      return { status: "failure", error: errorMsg };
    }
  } catch (error: any) {
    logger.page.error(
      page,
      `✗ Page "${page.name}" failed in locale:${locale} - ${error.message}`,
      locale,
      channel,
      targetGuid
    );
    return { status: "failure", error: error.message };
  }
}

/** PROD-3113: why a page whose parent isn't on the target is not saved. */
export function parentNotOnTargetError(
  sourceParentPageID: number,
  parentName?: string,
  parentInConflict = false
): string {
  const parent = parentName
    ? `"${parentName}" (source page ${sourceParentPageID})`
    : `source page ${sourceParentPageID}`;
  if (parentInConflict) {
    return (
      `wasn't saved: its parent page ${parent} is in conflict with a target page at the same path ` +
      `that has no mapping. Use --overwrite to map the parent and sync its children`
    );
  }
  return (
    `wasn't saved: its parent page ${parent} isn't on the target, because it failed or was skipped. ` +
    `Saving it anyway would put it at the root of the sitemap. Fix the parent page and sync again`
  );
}

interface AdoptProps {
  page: mgmtApi.PageItem;
  candidate: TargetPageCandidate;
  apiClient: mgmtApi.ApiClient;
  pageMapper: PageMapper;
  targetGuid: string;
  locale: string;
  channel: string;
  overwrite: boolean;
  logger: Logs;
}

/**
 * PROD-3113 / PROD-3026: an unmapped source page whose path already exists on the target. Decided
 * 2026-11-09, handled like a content conflict:
 * - without --overwrite: a conflict. Nothing is written (no mapping row, target page untouched);
 *   the warning gives the full path and both page IDs.
 * - with --overwrite: write the mapping row and update the target page in place (never delete
 *   and recreate it: it may have children).
 *
 * Returns `result` when processPage should stop here (conflict, preflight, or refused), or
 * `targetPage` when it should go on and update the mapped page (--overwrite).
 */
async function adoptTargetPage({
  page,
  candidate,
  apiClient,
  pageMapper,
  targetGuid,
  locale,
  channel,
  overwrite,
  logger,
}: AdoptProps): Promise<{ result?: PageProcessResult; targetPage?: mgmtApi.PageItem }> {
  const targetUrl = `https://app.agilitycms.com/instance/${targetGuid}/${locale}/pages/${candidate.pageID}`;
  const refuse = (error: string): { result: PageProcessResult } => {
    logger.page.error(page, `✗ Page "${page.name}" ${error}`, locale, channel, targetGuid);
    preflightReport.record({ phase: "Pages", action: "conflict", name: page.name, locale, detail: error });
    return { result: { status: "failure", error } };
  };

  // The same-named page belongs to a different source page; adopting it would map two source
  // pages to one target page.
  const mappedTo = pageMapper.getPageMappingByPageID(candidate.pageID, "target");
  if (mappedTo) {
    return refuse(
      `can't be created: the target already has a page at ${candidate.path} ` +
        `(page ${candidate.pageID}), and it is mapped to source page ${mappedTo.sourcePageID}. ` +
        `Rename one of them, or correct the page mappings. ${targetUrl}`
    );
  }

  if (pageTypesDiffer(page.pageType, candidate.pageType)) {
    return refuse(
      `can't be created: the target already has a ${sitemapTypeLabel(candidate.pageType)} at ` +
        `${candidate.path} (page ${candidate.pageID}), but on the source it's a ` +
        `${page.pageType} page. Rename or remove one of them. ${targetUrl}`
    );
  }

  const ids = `source page ${page.pageID}, target page ${candidate.pageID}`;

  if (!overwrite) {
    const reason = `exists on the target with no mapping (${ids})`;
    const sourceUrl = `https://app.agilitycms.com/instance/${state.sourceGuid}/${locale}/pages/${page.pageID}`;
    console.warn(
      `⚠️  Conflict detected Page ${ansiColors.underline(candidate.path)} — ${ansiColors.bold.grey(reason)}. ` +
        `Use --overwrite to map it and update it from the source.`
    );
    console.warn(`   - Source: ${sourceUrl}`);
    console.warn(`   - Target: ${targetUrl}`);
    logger.page.skipped(page, `conflict: ${candidate.path} ${reason}`, locale, channel, targetGuid);
    preflightReport.record({
      phase: "Pages",
      action: "conflict",
      name: page.name,
      locale,
      detail: `${candidate.path} ${reason}; --overwrite maps it and updates it from the source`,
    });
    return { result: { status: "skip", conflict: true } };
  }

  const mappedDetail = `${candidate.path} already exists on the target with no mapping (${ids}); mapping it`;

  if (state.preflight) {
    preflightReport.record({
      phase: "Pages",
      action: "update",
      name: page.name,
      locale,
      detail: `${mappedDetail} and replacing it with the source (--overwrite)`,
    });
    plannedTargetPageIDs.set(page.pageID, candidate.pageID);
    return { result: { status: "success", adopted: true } };
  }

  // The pulled copy holds the version the mapping row records; read it live if it wasn't pulled.
  let targetPage = new fileOperations(targetGuid, locale).readJsonFile(
    `page/${candidate.pageID}.json`
  ) as mgmtApi.PageItem | null;
  if (!targetPage?.properties) {
    try {
      targetPage = await apiClient.pageMethods.getPage(candidate.pageID, targetGuid, locale);
    } catch {
      targetPage = null;
    }
  }
  if (!targetPage?.properties) {
    return refuse(
      `can't be updated: the target already has a page at ${candidate.path} ` +
        `(page ${candidate.pageID}), and it couldn't be read to map it. ${targetUrl}`
    );
  }

  // sourceVersionID 0 ("never cleanly synced") makes the update below push the source, and the
  // row is rewritten with the real versions once that save succeeds.
  pageMapper.addMapping({ ...page, properties: { ...page.properties, versionID: 0 } } as mgmtApi.PageItem, targetPage);
  console.log(
    ansiColors.gray(`    ↪ Page "${page.name}": ${mappedDetail} and updating it from the source (--overwrite)`)
  );
  return { targetPage };
}

/**
 * PROD-2542: number of the page's modules whose source content is registered as failed in `locale`.
 * Used by preflight to preview the modules a real run would drop.
 */
export function countModulesReferencingFailedContent(page: mgmtApi.PageItem, locale: string): number {
  let count = 0;
  for (const zoneModules of Object.values(page?.zones || {})) {
    if (!Array.isArray(zoneModules)) continue;
    for (const module of zoneModules as any[]) {
      const sourceContentId = module?.item?.contentid || module?.item?.contentId;
      if (sourceContentId > 0 && getFailedContent(sourceContentId, locale)) count++;
    }
  }
  return count;
}
