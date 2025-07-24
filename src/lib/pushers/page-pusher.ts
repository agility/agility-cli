import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { state, getState, getApiClient } from "../../core/state";
import { SourceData, PusherProgressCallback, PusherResult } from "../../types/sourceData";
import { SitemapHierarchy } from "../shared/sitemap-hierarchy";
import { PageMapper } from "../mappers/page-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { TemplateMapper } from "lib/mappers/template-mapper";


// CRITICAL FIX: Translate zone names to match template content section definitions
/**
 * Get target sitemap for page lookups (cached for performance)
 */
let _targetSitemapCache: { [guid: string]: any } = {};

/**
 * Flatten nested sitemap structure to get all pages at all levels
 */
function flattenSitemapPages(pages: any[]): any[] {
  const flatPages: any[] = [];

  function addPagesRecursively(pageArray: any[]) {
    for (const page of pageArray) {
      flatPages.push(page);
      if (page.childPages && Array.isArray(page.childPages)) {
        addPagesRecursively(page.childPages);
      }
    }
  }

  addPagesRecursively(pages);
  return flatPages;
}

async function getTargetSitemap(apiClient: mgmtApi.ApiClient, targetGuid: string, locale: string): Promise<any> {
  const cacheKey = `${targetGuid}-${locale}`;

  if (!_targetSitemapCache[cacheKey]) {
    const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);
    _targetSitemapCache[cacheKey] = sitemap;

    const websiteChannel = sitemap?.find(channel => channel.digitalChannelTypeName === 'Website');
    if (websiteChannel && websiteChannel.pages) {
      const flatPages = flattenSitemapPages(websiteChannel.pages);
      (websiteChannel as any).flatPages = flatPages;
    }
  }

  return _targetSitemapCache[cacheKey];
}

/**
 * Clear the sitemap cache (useful for testing or when target instance changes)
 */
export function clearSitemapCache(targetGuid?: string, locale?: string): void {
  if (targetGuid && locale) {
    const cacheKey = `${targetGuid}-${locale}`;
    delete _targetSitemapCache[cacheKey];
  } else {
    _targetSitemapCache = {};
  }
}

/**
 * Find if a page already exists in the target instance using sitemap data
 */
// export async function findPageInTargetInstance(
//     sourcePage: mgmtApi.PageItem,
//     apiClient: mgmtApi.ApiClient,
//     targetGuid: string,
//     locale: string,
//     referenceMapper: ReferenceMapperV2,
//     sitemapPath?: string
// ): Promise<mgmtApi.PageItem | null> {

//     try {
//         // Check reference mappings first (fastest)
//         const existingMapping = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourcePage.pageID);
//         if (existingMapping?.target) {
//             // Found in mappings (silent)
//             return existingMapping.target;
//         }

//         // Get target sitemap and flatten nested pages
//         const sitemap = await getTargetSitemap(apiClient, targetGuid, locale);
//         const websiteChannel = sitemap?.find(channel => channel.digitalChannelTypeName === 'Website');

//         if (!websiteChannel || !(websiteChannel as any).flatPages) {
//             return null;
//         }

//         const targetPages = (websiteChannel as any).flatPages;

//         // Find pages with matching names - try multiple name variations
//         const nameMatches = targetPages.filter((targetPage: any) => {
//             const targetPageName = targetPage.pageName || targetPage.name || targetPage.title;
//             const targetMenuText = targetPage.menuText;

//             // Try exact name match first
//             if (targetPageName === sourcePage.name) return true;

//             // Try matching against menu text
//             if (targetMenuText && targetMenuText === sourcePage.name) return true;

//             // Try matching against source page's title and menuText
//             if (targetPageName === sourcePage.title || targetPageName === sourcePage.menuText) return true;

//             return false;
//         });

//         if (nameMatches.length === 0) {
//             return null;
//         }

//         if (nameMatches.length === 1) {
//             // Single match - return it
//             const match = nameMatches[0];
//             const fullPage = await apiClient.pageMethods.getPage(match.pageID, targetGuid, locale);
//             return fullPage;
//         }

//         // Multiple matches - use parent hierarchy to disambiguate
//         const sourceParentId = sourcePage.parentPageID || (sourcePage as any).parentID || -1;
//         let targetParentId = -1;

//         if (sourceParentId > 0) {
//             const parentMapping = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourceParentId);
//             if (parentMapping?.target) {
//                 targetParentId = parentMapping.target.pageID;
//             }
//         }

//         // Find best match based on hierarchy
//         const hierarchyMatch = nameMatches.find((targetPage: any) => {
//             const targetPageParentId = targetPage.parentPageID || targetPage.parentID || -1;
//             return (targetParentId === -1 && targetPageParentId <= 0) ||
//                    (targetParentId === targetPageParentId);
//         });

//         if (hierarchyMatch) {
//             const fullPage = await apiClient.pageMethods.getPage(hierarchyMatch.pageID, targetGuid, locale);
//             return fullPage;
//         }

//         // If no hierarchy match, check for exact path match
//         const pathMatch = nameMatches.find((targetPage: any) => {
//             const targetPath = targetPage.path || '';
//             const sourcePath = sourcePage.path || '';
//             return targetPath === sourcePath;
//         });

//         if (pathMatch) {
//             const fullPage = await apiClient.pageMethods.getPage(pathMatch.pageID, targetGuid, locale);
//             return fullPage;
//         }

//         // If still multiple matches, return the first one but log a warning
//         if (nameMatches.length > 1) {
//             console.warn(`⚠️ Multiple pages found with name "${sourcePage.name}" in target instance. Using first match (ID: ${nameMatches[0].pageID})`);
//         }

//         const firstMatch = nameMatches[0];
//         const fullPage = await apiClient.pageMethods.getPage(firstMatch.pageID, targetGuid, locale);
//         return fullPage;

//     } catch (error: any) {
//         return null;
//     }
// }

// export async function findPageInTargetInstanceEnhanced(
//     sourcePage: mgmtApi.PageItem,
//     apiClient: mgmtApi.ApiClient,
//     targetGuid: string,
//     locale: string,
//     targetData: any,
//     referenceMapper: ReferenceMapperV2
// ): Promise<{ page: mgmtApi.PageItem | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: ChangeDetection }> {
//     const state = getState();

//     // STEP 1: Find existing mapping
//     const existingMapping = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourcePage.pageID);
//     let targetPageFromMapping: mgmtApi.PageItem | null = existingMapping?.target || null;

//     // STEP 2: Find target instance data
//     const targetInstanceData = targetData.pages?.find((p: any) =>
//         p.pageID === targetPageFromMapping?.pageID || p.name === sourcePage.name || p.path === sourcePage.path
//     );

//     // STEP 3: Fallback to API search if not found in data
//     let finalTargetPage: mgmtApi.PageItem | null = targetInstanceData || targetPageFromMapping;
//     if (!finalTargetPage) {
//         finalTargetPage = await findPageInTargetInstance(sourcePage, apiClient, targetGuid, locale, referenceMapper);
//     }

//     // STEP 4: Use change detection for conflict resolution
//     const decision = changeDetection(
//         sourcePage,
//         targetPageFromMapping,
//         targetInstanceData
//     );

//     return {
//         page: finalTargetPage,
//         shouldUpdate: decision.shouldUpdate,
//         shouldCreate: decision.shouldCreate,
//         shouldSkip: decision.shouldSkip,
//         decision: decision
//     };
// }

function translateZoneNames(sourceZones: any, targetTemplate: mgmtApi.PageModel | null): any {
  if (!sourceZones || !targetTemplate?.contentSectionDefinitions) {
    return sourceZones || {}; // No template or sections, return as-is
  }

  const translatedZones: any = {};
  const sectionNames = targetTemplate.contentSectionDefinitions
    .sort((a, b) => (a.itemOrder || 0) - (b.itemOrder || 0)) // Sort by item order
    .map((def) => def.pageItemTemplateReferenceName);

  // Map source zones to template section names in order
  const sourceZoneEntries = Object.entries(sourceZones);

  for (let i = 0; i < sourceZoneEntries.length && i < sectionNames.length; i++) {
    const [sourceZoneName, zoneContent] = sourceZoneEntries[i];
    const targetZoneName = sectionNames[i];
    translatedZones[targetZoneName] = zoneContent;
  }

  // CRITICAL FIX: Instead of dropping extra zones, combine them into the main zone
  if (sourceZoneEntries.length > sectionNames.length && sectionNames.length > 0) {
    const mainZoneName = sectionNames[0]; // Use first (main) zone as target
    const mainZoneModules = Array.isArray(translatedZones[mainZoneName]) ? [...translatedZones[mainZoneName]] : [];

    for (let i = sectionNames.length; i < sourceZoneEntries.length; i++) {
      const [sourceZoneName, zoneContent] = sourceZoneEntries[i];
      if (Array.isArray(zoneContent) && zoneContent.length > 0) {
        mainZoneModules.push(...zoneContent);
      }
    }

    translatedZones[mainZoneName] = mainZoneModules;
  }

  return translatedZones;
}

// Internal helper function to process a single page
async function processPage(
  page: mgmtApi.PageItem,
  sourceGuid: string,
  targetGuid: string,
  locale: string,
  isChildPage: boolean,
  apiClient: mgmtApi.ApiClient,
  overwrite: boolean = false,
  insertBeforePageId: number | null = null
): Promise<"success" | "skip" | "failure"> {
  // Returns 'success', 'skip', or 'failure'

  let existingPage: mgmtApi.PageItem | null = null;
  let correctPageID = -1;
  let channelID = -1;

  const referenceMapper = new PageMapper(sourceGuid, targetGuid, locale);


  const templateMapper = new TemplateMapper(sourceGuid, targetGuid);
  try {
    let targetTemplate: mgmtApi.PageModel | null = null;
    // Only try to find template mapping for non-folder pages
    if (page.pageType !== "folder" && page.templateName) {
      // Find the template mapping
      let templateRef = templateMapper.getTemplateMappingByPageTemplateName(page.templateName, 'source');
      if (!templateRef) {
        console.error(
          ansiColors.yellow(
            `✗ Page ${page.name} template ${ansiColors.underline(page.templateName)} missing in source data, skipping`
          )
        );
        return "skip";
      }
      targetTemplate = templateMapper.getMappedEntity(templateRef, 'target') as mgmtApi.PageModel;
    }

    // Check if page already exists in target instance using proper matching
    // Use the internal findPageInTargetInstance function from this same file

    const pageMapping = referenceMapper.getPageMapping(page, 'source');
    if (pageMapping) {
      existingPage = referenceMapper.getMappedEntity(pageMapping, 'target');
    } else {


      // existingPage = await findPageInTargetInstance(page, apiClient, targetGuid, locale, referenceMapper);
    }

    // existingPage = await findPageInTargetInstance(page, apiClient, targetGuid, locale, referenceMapper);

    // CRITICAL FIX: Always get target instance channel ID to avoid FK constraint errors
    // Get channel ID from target instance sitemap (not from existing page which may be invalid)
    const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);
    const websiteChannel = sitemap?.find((channel) => channel.digitalChannelTypeName === "Website");
    if (websiteChannel) {
      channelID = websiteChannel.digitalChannelID;
    } else {
      channelID = sitemap?.[0]?.digitalChannelID || 1; // Fallback to first channel or default
    }

    if (existingPage && !overwrite) {
      correctPageID = existingPage.pageID;
      // Add to reference mapper for future lookups
      referenceMapper.addMapping(page, existingPage);

      const pageTypeDisplay =
        {
          static: "Page",
          link: "Link",
          folder: "Folder",
        }[page.pageType] || page.pageType;

      console.log(
        `✓ ${pageTypeDisplay} ${ansiColors.underline(page.name)} ${ansiColors.bold.grey("up to date, skipping")}`
      );
      return "skip"; // Skip processing - page already exists
    } else if (existingPage && overwrite) {
      // Force update mode: use existing page ID for update
      correctPageID = existingPage.pageID;
      // Don't add to reference mapper yet - will do after successful update
    } else {
      // Page doesn't exist - will create new
      // Channel ID already set from target sitemap above
    }

    // Map Content IDs in Zones
    // Handle folder pages which may not have zones
    let sourceZones = page.zones ? { ...page.zones } : {}; // Clone zones or use empty object

    // CRITICAL: Translate zone names to match template expectations BEFORE content mapping
    let mappedZones = translateZoneNames(sourceZones, targetTemplate);

    // Content mapping validation - collect all content IDs that need mapping
    const contentIdsToValidate: number[] = [];
    for (const [zoneName, zoneModules] of Object.entries(mappedZones)) {
      if (Array.isArray(zoneModules)) {
        for (const module of zoneModules) {
          if (module.item && typeof module.item === "object") {
            const sourceContentId = module.item.contentid || module.item.contentId;
            if (sourceContentId && sourceContentId > 0) {
              contentIdsToValidate.push(sourceContentId);
            }
          }
        }
      }
    }

    // Content mapping validation (silent unless errors)

    const contentMapper = new ContentItemMapper(sourceGuid, targetGuid, locale);

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
              const { targetContentID } = contentMapper.getContentItemMappingByContentID(sourceContentId, 'source');
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
                // Content mapping failed - log detailed debug info for troubleshooting
                console.error(
                  `❌ No content mapping found for ${module.module}: contentID ${sourceContentId} in page ${page.name}`
                );
                // const contentMappings = contentMapper.getRecordsByType("content");

                // console.log("Page", JSON.stringify(page, null, 2));
                // console.error(`Total content mappings available: ${contentMappings.length}`);
                // const allContentRecords = referenceMapper.getRecordsByType("content");
                // const matchingRecord = allContentRecords.find((r) => r.source.contentID === sourceContentId);
                // if (matchingRecord) {
                //   console.error(`Found matching source record but issue with target:`, {
                //     sourceID: matchingRecord.source.contentID,
                //     targetID: matchingRecord.target?.contentID,
                //     hasTarget: !!matchingRecord.target,
                //   });
                // } else {
                //   console.error(`No record found with source contentID: ${sourceContentId}`);
                // }
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

    // Content mapping validation - check which mappings were successful
    if (contentIdsToValidate.length > 0) {
      const mappingResults: { [contentId: number]: { found: boolean; targetId?: number; error?: string } } = {};
      let foundMappings = 0;
      let missingMappings = 0;

      contentIdsToValidate.forEach((sourceContentId) => {
        const { targetContentID } = contentMapper.getContentItemMappingByContentID(sourceContentId, 'source');
        if (targetContentID) {
          mappingResults[sourceContentId] = {
            found: true,
            targetId: targetContentID,
          };
          foundMappings++;
        } else {
          mappingResults[sourceContentId] = {
            found: false,
            error: targetContentID ? "Invalid target ID" : "No mapping found",
          };
          missingMappings++;
        }
      });

      if (missingMappings > 0) {
        console.error(
          ansiColors.bgRed(
            `✗ Page "${page.name}" failed - ${missingMappings}/${contentIdsToValidate.length} missing content mappings`
          )
        );
        return "failure";
      }
    }

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
      if (originalModuleCount > 0 && !existingPage && !isLegitimateEmptyPage(page)) {
        console.error(`✗ Page "${page.name}" lost all ${originalModuleCount} modules during content mapping`);
        return "failure";
      }
    }

    // Prepare payload - ensure proper null handling
    // Fix zones format - ensure zones is always a defined object (never null/undefined)
    const formattedZones = mappedZones && typeof mappedZones === "object" ? mappedZones : {};

    // CRITICAL FIX: Ensure every page has a valid title field
    // Folder pages often don't have titles, but API requires them
    const pageTitle = page.title || page.menuText || page.name || "Untitled Page";

    const payload: mgmtApi.PageItem = {
      ...page,
      pageID: existingPage ? existingPage.pageID : -1,
      title: pageTitle, // CRITICAL: Ensure title is always present
      channelID: channelID, // CRITICAL: Always use target instance channel ID to avoid FK constraint errors
      zones: formattedZones,
      // CRITICAL: Include path field from sitemap enrichment (API bug: target sitemap returns null paths)
      path: page.path || "",
    };

    // Map parent page ID if present - CRITICAL: Use parentID field (not parentPageID)
    let parentIDArg = -1;
    // CRITICAL FIX: Use parentID as the correct field name (SDK documentation confirms this)
    const sourceParentId = payload.parentPageID;
    if (sourceParentId && sourceParentId > 0) {
      const mapping = referenceMapper.getPageMappingByPageID(sourceParentId, 'source');
      if ((mapping?.targetPageID || 0) > 0) {
        parentIDArg = mapping.targetPageID;
        // CRITICAL FIX: Set parentID in payload (not parentPageID)
        payload.parentPageID = mapping.targetPageID;
      } else {
        parentIDArg = -1;
        payload.parentPageID = -1; // No parent
      }
    } else {
      payload.parentPageID = -1; // Ensure no parent
    }

    // CRITICAL: Remove both parentPageID and parentID fields to avoid API confusion
    // The API uses parentIDArg parameter, not payload fields
    const hadParentPageID = !!(payload as any).parentPageID;
    const hadParentID = !!(payload as any).parentID;
    // delete (payload as any).parentPageID;
    delete (payload as any).parentID;

    // Parent fields cleaned up (silent)

    // Map placeBeforePageItemID - prioritize insertBeforePageId parameter for sibling ordering
    let placeBeforeIDArg = -1;
    if (insertBeforePageId && insertBeforePageId > 0) {
      // Use the calculated insertBefore pageID for proper sibling ordering
      placeBeforeIDArg = insertBeforePageId;
    } else if (payload.placeBeforePageItemID && payload.placeBeforePageItemID > 0) {
      // Fallback to original placeBeforePageItemID if available
      const mapping = referenceMapper.getPageMappingByPageID(payload.placeBeforePageItemID, 'source');
      if ((mapping?.targetPageID || 0) > 0) {
        placeBeforeIDArg = mapping.targetPageID;
      } else {
        placeBeforeIDArg = -1;
      }
    }

    // Save the page with returnBatchID flag for consistent batch processing
    const savePageResponse = await apiClient.pageMethods.savePage(
      payload,
      targetGuid,
      locale,
      parentIDArg,
      placeBeforeIDArg,
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
      const { pollBatchUntilComplete, extractBatchResults } = await import("./batch-polling");
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
      const { successfulItems: batchSuccessItems, failedItems: batchFailedItems } = extractBatchResults(
        completedBatch,
        [page]
      );

      let actualPageID = -1;
      if (batchSuccessItems.length > 0) {
        actualPageID = batchSuccessItems[0].newId;
      } else if (batchFailedItems.length > 0) {
        console.error(`✗ Page ${page.name} batch failed: ${batchFailedItems[0].error}`);
      }

      if (actualPageID > 0) {
        // Success case
        const createdPageData = {
          ...payload, // Use the payload data which has mapped zones
          pageID: actualPageID,
        } as mgmtApi.PageItem;
        referenceMapper.addMapping(page, createdPageData); // Use original page for source key

        const pageTypeDisplay =
          {
            static: "Page",
            link: "Link",
            folder: "Folder",
          }[page.pageType] || page.pageType;

        if (existingPage) {
          if (overwrite) {
            console.log(
              `✓ ${pageTypeDisplay} ${ansiColors.underline(page.name)} ${ansiColors.bold.cyan(
                "updated (forced)"
              )} - ${ansiColors.green(targetGuid)}: ID:${actualPageID} (Template:${page.templateName || "None"})`
            );
          } else {
            console.log(
              `✓ ${pageTypeDisplay} ${ansiColors.underline(page.name)} ${ansiColors.bold.cyan(
                "updated"
              )} - ${ansiColors.green(targetGuid)}: ID:${actualPageID} (Template:${page.templateName || "None"})`
            );
          }
        } else {
          console.log(
            `✓ ${pageTypeDisplay} ${ansiColors.underline(page.name)} ${ansiColors.bold.green(
              "created"
            )} - ${ansiColors.green(targetGuid)}: ID:${actualPageID} (Template:${page.templateName || "None"})`
          );
        }
        return "success"; // Success
      } else {
        // Show errorData if available, otherwise generic failure
        if (completedBatch.errorData && completedBatch.errorData.trim()) {
          console.error(`✗ Page "${page.name}" failed - ${completedBatch.errorData}`);
        } else {
          console.error(`✗ Page "${page.name}" failed - invalid page ID: ${actualPageID}`);
        }
        return "failure";
      }
    } else {
      console.error(`✗ Page "${page.name}" failed - unexpected response format`);
      return "failure"; // Failure
    }
  } catch (error: any) {
    console.error(`✗ Page "${page.name}" failed - ${error.message}`);
    return "failure"; // Failure
  }
}

export async function pushPages(
  sourceData: mgmtApi.PageItem[],
  targetData: mgmtApi.PageItem[],
  // onProgress?: PusherProgressCallback
): Promise<PusherResult> {
  // Extract data from sourceData - unified parameter pattern
  let pages: mgmtApi.PageItem[] = sourceData || [];

  const { sourceGuid, targetGuid, locale } = state;
  const pageMapper = new PageMapper(sourceGuid[0], targetGuid[0], locale[0]);

  if (!pages || pages.length === 0) {
    console.log("No pages found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  // Pages are processed as-is since Agility API prevents true duplicates at same hierarchy level

  // Page hierarchy enrichment with dynamic page support and sibling ordering
  let pageOrderingData: any = null;
  try {


    const sitemapHierarchy = new SitemapHierarchy();

    const sitemaps = await sitemapHierarchy.loadAllSitemaps();
    const channels = Object.keys(sitemaps);

    console.log(`Processing ${pages.length} pages across ${channels.length} channels...`);

    //loop all the channels
    for (const channel of channels) {
      const sitemap = sitemaps[channel];

      // Check for dynamic pages without verbose logging
      const hasDynamicPages = pages.some((page: any) => page.pageType === "dynamic");
      if (hasDynamicPages) {
        sitemapHierarchy.debugPageHierarchyIssues(pages, channel);
      }

      if (sitemap && sitemap.length > 0) {
        // NEW: Use enhanced ordering that preserves both parent-child AND sibling relationships
        const orderingResult = sitemapHierarchy.getOrderedProcessingSequence(pages, sitemap);
        pageOrderingData = orderingResult.orderingData;
        const hierarchy = pageOrderingData.hierarchy;

        if (hierarchy && Object.keys(hierarchy).length > 0) {
          // Validate processing order is dependency-safe
          const isValidOrder = sitemapHierarchy.validateProcessingOrder(orderingResult.orderedPages, hierarchy);
          if (!isValidOrder) {
            console.warn("⚠️ Page processing order validation failed - proceeding with original order");
          } else {
            // Use the dependency-safe order that also preserves sibling order
            pages = orderingResult.orderedPages;

          }

          // Build child-to-parent mapping for efficient lookup
          const childToParentMap: { [childId: number]: number } = {};
          Object.entries(hierarchy).forEach(([parentIdStr, childIds]) => {
            const parentId = parseInt(parentIdStr);
            (childIds as number[]).forEach((childId) => {
              childToParentMap[childId] = parentId;
            });
          });

          // Enrich each page with parent relationship information
          let enrichedCount = 0;
          pages = pages.map((page: any) => {
            // First check existing parentPageID
            let parentId = page.parentPageID && page.parentPageID > 0 ? page.parentPageID : null;

            // If no parent found, try hierarchy mapping
            if (!parentId) {
              parentId = childToParentMap[page.pageID];
            }

            // For dynamic pages, use comprehensive lookup if still no parent
            if (!parentId && page.pageType === "dynamic") {
              const lookup = sitemapHierarchy.findPageParentInSourceSitemap(page.pageID, page.name, channel);
              if (lookup.parentId) {
                parentId = lookup.parentId;
                // Only log if parent lookup fails completely
              } else {
                console.warn(`⚠️ No parent found for dynamic page ${page.name} - may cause validation issues`);
              }
            }

            if (parentId && parentId > 0) {
              enrichedCount++;
              return { ...page, parentPageID: parentId, parentID: parentId };
            } else {
              return { ...page, parentPageID: -1, parentID: -1 };
            }
          });

          // if (enrichedCount > 0) {
          //   console.log(`✅ Enriched ${enrichedCount} pages with parent relationships`);
          // }

          // Only warn about orphaned dynamic pages (simplified)
          const orphanedDynamicPages = pages.filter(
            (page: any) => page.pageType === "dynamic" && (!page.parentPageID || page.parentPageID <= 0)
          );
          if (orphanedDynamicPages.length > 0) {
            console.warn(`⚠️ ${orphanedDynamicPages.length} dynamic pages without parents may cause issues`);
          }
        } else {
          // Sitemap exists but no hierarchy - silent processing
        }
      } else {
        // No sitemap found - silent processing
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Page hierarchy enrichment failed: ${error.message} - proceeding with original order`);
  }

  let successful = 0;
  let failed = 0;
  let skipped = 0; // No duplicates to skip since API prevents true duplicates at same hierarchy level
  let status: "success" | "error" = "success";
  const publishableIds: number[] = []; // Track target page IDs for auto-publishing



  // Use centralized apiClient creation with lazy initialization

  const apiClient = getApiClient();

  // Use simple legacy pattern - track processed pages directly
  const processedPages: { [oldPageId: number]: number } = {}; // oldPageId -> newPageId
  const processedContentIds: { [oldContentId: number]: number } = {}; // oldContentId -> newContentId



  let totalPages = pages.length;
  let processedPagesCount = 0;


  // Process all pages in the calculated order
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    // Determine if this is a child page (has parent)
    const parentPageID = page.parentPageID || -1;
    const isChildPage = parentPageID > 0;

    // Calculate insertBefore pageID for proper sibling ordering
    let insertBeforePageId: number | null = null;
    if (pageOrderingData?.siblingOrder) {
      const sitemapHierarchy = new SitemapHierarchy();
      const sourceInsertBeforeId = sitemapHierarchy.getInsertBeforePageId(page.pageID, pageOrderingData.siblingOrder);

      if (sourceInsertBeforeId !== null) {
        // Map the source insertBefore ID to target insertBefore ID
        const mapping = pageMapper.getPageMappingByPageID(sourceInsertBeforeId, 'source');
        if ((mapping?.targetPageID || 0) > 0) {
          insertBeforePageId = mapping.targetPageID;
        }
      }
    }
    const { sourceGuid, targetGuid, locale, overwrite } = state;
    const result = await processPage(
      page,
      sourceGuid[0],
      targetGuid[0],
      locale[0],
      isChildPage,
      apiClient,
      overwrite,
      insertBeforePageId
    );

    const referenceMapper = new PageMapper(sourceGuid[0], targetGuid[0], locale[0]);
    if (result === "success") {
      successful++; // Page was processed successfully (created or updated)


      // Collect target page ID for auto-publishing
      const mapping = referenceMapper.getPageMappingByPageID(page.pageID, 'source');
      if ((mapping?.targetPageID || 0) > 0) {
        publishableIds.push(mapping.targetPageID);
      }
    } else if (result === "skip") {
      skipped++; // Page already exists and was skipped

      // Still collect target page ID for auto-publishing (skipped pages still exist)
      const mapping = referenceMapper.getPageMappingByPageID(page.pageID, 'source');
      if ((mapping?.targetPageID || 0) > 0) {
        publishableIds.push(mapping.targetPageID);
      }
    } else {
      failed++;
      status = "error";
    }
    processedPagesCount++;
    // if (onProgress && typeof onProgress === "function") {
    //   onProgress(processedPagesCount, totalPages, result === "failure" ? "error" : "success");
    // }
  }

  return { status, successful, failed, skipped, publishableIds };
}
