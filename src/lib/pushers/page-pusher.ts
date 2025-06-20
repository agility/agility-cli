import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapper } from "../reference-mapper";

// Batch polling utilities
interface BatchPollResult {
    success: boolean;
    batch: any;
    error?: string;
}

async function pollBatchStatus(apiClient: mgmtApi.ApiClient, batchID: number, targetGuid: string, maxAttempts: number = 30): Promise<BatchPollResult> {
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            // Get batch status - try different possible method names
            const batchStatus = await (apiClient as any).pageMethods?.getAsyncBatchStatus?.(batchID, targetGuid)
                || await (apiClient as any).utilityMethods?.getAsyncBatchStatus?.(batchID, targetGuid)
                || await (apiClient as any).utilityMethods?.getBatchStatus?.(batchID, targetGuid)
                || await (apiClient as any).utilityMethods?.getBatch?.(batchID, targetGuid);

            if (!batchStatus) {
                console.warn(`No batch status returned from API (attempt ${attempts + 1}/${maxAttempts})`);
                attempts++;
                if (attempts >= maxAttempts) {
                    return {
                        success: false,
                        batch: null,
                        error: `Batch status API unavailable after ${maxAttempts} attempts`
                    };
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }

            // Check for errorData immediately - don't wait for completion
            if (batchStatus.errorData && batchStatus.errorData.trim()) {
                console.error(`Batch ${batchID} has errorData - failing immediately`);
                console.error(`ErrorData: ${batchStatus.errorData.substring(0, 500)}...`);
                return {
                    success: false,
                    batch: batchStatus,
                    error: `Batch has errorData - ${batchStatus.errorData.substring(0, 200)}...`
                };
            }

            // batchState meanings: 1=Queued, 2=Processing, 3=Complete, 4=Error, 5=Cancelled
            if (batchStatus.batchState === 3) {
                // Complete and no errorData (checked above)
                return {
                    success: true,
                    batch: batchStatus
                };
            } else if (batchStatus.batchState === 4 || batchStatus.batchState === 5) {
                // Error or Cancelled
                return {
                    success: false,
                    batch: batchStatus,
                    error: `Batch failed with state ${batchStatus.batchState}: ${batchStatus.errorData || 'Unknown error'}`
                };
            }

            // Still processing, wait and retry
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            attempts++;

        } catch (error: any) {
            console.warn(`Error checking batch status (attempt ${attempts + 1}/${maxAttempts}): ${error.message}`);
            attempts++;
            if (attempts >= maxAttempts) {
                return {
                    success: false,
                    batch: null,
                    error: `Failed to poll batch status after ${maxAttempts} attempts: ${error.message}`
                };
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return {
        success: false,
        batch: null,
        error: `Batch polling timed out after ${maxAttempts} attempts`
    };
}

function extractPageIDFromBatch(batch: any, pageName: string): number {
    if (!batch.items || !Array.isArray(batch.items)) {
        console.error(`No items found in batch for page ${pageName}`);
        return -1;
    }

    // Look for the page in batch items
    for (const item of batch.items) {
        // itemType 1 = Page, check for valid page with actual ID
        if (item.itemType === 1) {
            // Check if this is our page (match by title or if it's the only page)
            const isTargetPage = item.itemTitle === pageName ||
                (batch.items.filter(i => i.itemType === 1).length === 1);

            if (isTargetPage && item.itemID > 0 && !item.itemNull) {
                return item.itemID;
            }
        }
    }

    console.error(`No valid page found in batch items for ${pageName}`);
    console.error(`Available items:`, batch.items.map(item => ({
        type: item.itemType,
        title: item.itemTitle,
        id: item.itemID,
        null: item.itemNull
    })));
    return -1;
}

// Helper function (copied from push_new.ts)
function wrapLines(str: string, width: number = 80): string {
    try {
        return str
            ?.split('\n')
            ?.map(line => {
                const result = [];
                while (line.length > width) {
                    let sliceAt = line.lastIndexOf(' ', width);
                    if (sliceAt === -1) sliceAt = width;
                    result.push(line.slice(0, sliceAt));
                    line = line.slice(sliceAt).trimStart();
                }
                result.push(line);
                return result.join('\n');
            })
            ?.join('\n');
    } catch (error) {
        console.warn("Error wrapping lines:", error);
        return str || ''; // Return original string or empty string if null/undefined
    }
}

// CRITICAL FIX: Translate zone names to match template content section definitions
function translateZoneNames(sourceZones: any, targetTemplate: mgmtApi.PageModel | null): any {
    if (!sourceZones || !targetTemplate?.contentSectionDefinitions) {
        return sourceZones || {}; // No template or sections, return as-is
    }

    const translatedZones: any = {};
    const sectionNames = targetTemplate.contentSectionDefinitions
        .sort((a, b) => (a.itemOrder || 0) - (b.itemOrder || 0)) // Sort by item order
        .map(def => def.pageItemTemplateReferenceName);

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
    targetGuid: string,
    locale: string,
    isChildPage: boolean,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    forceUpdate: boolean = false
): Promise<boolean> { // Returns true on success, false on failure

    let existingPage: mgmtApi.PageItem | null = null;
    let correctPageID = -1;
    let channelID = -1;

    try {
        let targetTemplate: mgmtApi.PageModel | null = null;

        // Only try to find template mapping for non-folder pages
        if (page.pageType !== 'folder' && page.templateName) {
            // Find the template mapping
            let templateRef = referenceMapper.getMappingByKey<mgmtApi.PageModel>('template', 'pageTemplateName', page.templateName);
            if (!templateRef?.target) {
                console.error(`✗ Template ${page.templateName} not found or processed for page: ${page.name}`);
                console.error(`Available template mappings:`, referenceMapper.getRecordsByType('template').map(r => `${r.source.pageTemplateName} -> ${r.target?.pageTemplateName || 'null'}`));
                return false;
            }
            targetTemplate = templateRef.target;
        }

        // Check if page already exists in target instance using proper matching
        const { findPageInTargetInstance } = await import('../finders/page-finder');
        existingPage = await findPageInTargetInstance(page, apiClient, targetGuid, locale, referenceMapper);
        
        // CRITICAL FIX: Always get target instance channel ID to avoid FK constraint errors
        // Get channel ID from target instance sitemap (not from existing page which may be invalid)
        const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);
        const websiteChannel = sitemap?.find(channel => channel.digitalChannelTypeName === 'Website');
        if (websiteChannel) {
            channelID = websiteChannel.digitalChannelID;
        } else {
            channelID = sitemap?.[0]?.digitalChannelID || 1; // Fallback to first channel or default
        }

        if (existingPage && !forceUpdate) {
            correctPageID = existingPage.pageID;
            // Add to reference mapper for future lookups
            referenceMapper.addRecord('page', page, existingPage);
            
            console.log(`✓ Page ${ansiColors.underline(page.name)} ${ansiColors.bold.grey('exists')} - ${ansiColors.green(targetGuid)}: ID:${existingPage.pageID} (Template:${page.templateName || 'None'})`);
            return true; // Skip processing - page already exists
        } else if (existingPage && forceUpdate) {
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
                    if (module.item && typeof module.item === 'object') {
                        const sourceContentId = module.item.contentid || module.item.contentId;
                        if (sourceContentId && sourceContentId > 0) {
                            contentIdsToValidate.push(sourceContentId);
                        }
                    }
                }
            }
        }

        // Content mapping validation (silent unless errors)

        for (const [zoneName, zoneModules] of Object.entries(mappedZones)) {
            const newZoneContent = [];
            if (Array.isArray(zoneModules)) {
                for (const module of zoneModules) {
                    // Create copy of module to avoid modifying original
                    const newModule = { ...module };

                    // Check if module has content item reference
                    if (module.item && typeof module.item === 'object') {
                        // CRITICAL FIX: Check both contentid (lowercase) and contentId (camelCase)
                        // The page data contains "contentid" (lowercase) but code was checking "contentId"
                        const sourceContentId = module.item.contentid || module.item.contentId;

                        if (sourceContentId && sourceContentId > 0) {
                            const contentRef = referenceMapper.getContentMappingById(sourceContentId);

                            if (contentRef?.target && (contentRef.target as any).contentID > 0) {
                                // CRITICAL FIX: Map to target content ID and remove duplicate fields
                                const targetContentId = (contentRef.target as any).contentID;
                                newModule.item = {
                                    ...module.item,
                                    contentid: targetContentId, // Use target content ID only
                                    fulllist: module.item.fulllist
                                };
                                // Remove contentId field to avoid confusion
                                delete newModule.item.contentId;
                                newZoneContent.push(newModule);
                            } else {
                                // Content mapping failed - log detailed debug info for troubleshooting
                                console.error(`❌ No content mapping found for ${module.module}: contentID ${sourceContentId} in page ${page.name}`);
                                const contentMappings = referenceMapper.getRecordsByType('content');
                                console.error(`Total content mappings available: ${contentMappings.length}`);
                                const allContentRecords = referenceMapper.getRecordsByType('content');
                                const matchingRecord = allContentRecords.find(r => r.source.contentID === sourceContentId);
                                if (matchingRecord) {
                                    console.error(`Found matching source record but issue with target:`, {
                                        sourceID: matchingRecord.source.contentID,
                                        targetID: matchingRecord.target?.contentID,
                                        hasTarget: !!matchingRecord.target
                                    });
                                } else {
                                    console.error(`No record found with source contentID: ${sourceContentId}`);
                                }
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

            contentIdsToValidate.forEach(sourceContentId => {
                const contentRef = referenceMapper.getContentMappingById(sourceContentId);
                if (contentRef?.target && (contentRef.target as any).contentID > 0) {
                    mappingResults[sourceContentId] = { 
                        found: true, 
                        targetId: (contentRef.target as any).contentID 
                    };
                    foundMappings++;
                } else {
                    mappingResults[sourceContentId] = { 
                        found: false, 
                        error: contentRef ? 'Invalid target ID' : 'No mapping found' 
                    };
                    missingMappings++;
                }
            });

            if (missingMappings > 0) {
                console.error(`✗ Page "${page.name}" failed - ${missingMappings}/${contentIdsToValidate.length} missing content mappings`);
                return false;
            }
        }

        // Check if page has any content left after filtering
        const totalModules = Object.values(mappedZones).reduce((sum: number, zone) => {
            return sum + (Array.isArray(zone) ? zone.length : 0);
        }, 0);

        // Helper function to check if a page legitimately can have no modules
        const isLegitimateEmptyPage = (page: mgmtApi.PageItem): boolean => {
            // Folder pages don't have content modules
            if (page.pageType === 'folder') return true;
            
            // Link pages don't have content modules - they redirect to other URLs/pages/files
            if (page.pageType === 'link') return true;
            
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
                return false;
            }
        }

        // Prepare payload - ensure proper null handling
        // Fix zones format - ensure zones is always a defined object (never null/undefined)
        const formattedZones = mappedZones && typeof mappedZones === 'object' ? mappedZones : {};

        // CRITICAL FIX: Ensure every page has a valid title field
        // Folder pages often don't have titles, but API requires them
        const pageTitle = page.title || page.menuText || page.name || "Untitled Page";

        const payload: mgmtApi.PageItem = {
            ...page,
            pageID: existingPage ? existingPage.pageID : -1,
            title: pageTitle, // CRITICAL: Ensure title is always present
            // pageTemplateID: targetTemplate ? targetTemplate.pageTemplateID : null, // null for folder pages
            channelID: channelID, // CRITICAL: Always use target instance channel ID to avoid FK constraint errors
            zones: formattedZones,
            // CRITICAL: Include path field from sitemap enrichment (API bug: target sitemap returns null paths)
            path: page.path || "",
            // CRITICAL: Clean up SEO object - ensure no null values that cause API errors
            // seo: {
            //     metaDescription: page.seo?.metaDescription || "",
            //     metaKeywords: page.seo?.metaKeywords || "",
            //     metaHTML: page.seo?.metaHTML || "",
            //     menuVisible: page.seo?.menuVisible ?? true, // Default to true instead of null
            //     sitemapVisible: page.seo?.sitemapVisible ?? true // Default to true instead of null
            // },
            // Ensure scripts have proper string values instead of null
            // scripts: {
            //     excludedFromGlobal: page.scripts?.excludedFromGlobal || false,
            //     top: page.scripts?.top || "",
            //     bottom: page.scripts?.bottom || ""
            // },
            // // Ensure visible properties are properly set
            // visible: {
            //     menu: page.visible?.menu !== false, // Default to true unless explicitly false
            //     sitemap: page.visible?.sitemap !== false // Default to true unless explicitly false
            // },
            // // Remove potentially problematic fields for new page creation
            // ...(existingPage ? {} : {
            //     // For new pages, remove fields that might cause validation issues
            //     properties: undefined,  // Remove properties with state and versionID
            //     modified: undefined,    // Remove timestamps
            //     versionID: undefined,   // Remove version tracking
            //     // Clean up dynamic page configuration
            //     dynamic: page.dynamic ? {
            //         referenceName: page.dynamic.referenceName,
            //         fieldName: page.dynamic.fieldName || "",
            //         titleFormula: null,
            //         menuTextFormula: null,
            //         pageNameFormula: null,
            //         visibleOnMenu: null,
            //         visibleOnSitemap: null
            //     } : undefined
            // })
        };

        // Map parent page ID if present - CRITICAL: Use parentID field (not parentPageID)
        let parentIDArg = -1;
        // CRITICAL FIX: Use parentID as the correct field name (SDK documentation confirms this)
        const sourceParentId = payload.parentPageID;
        if (sourceParentId && sourceParentId > 0) {
            const parentPageRef = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourceParentId);
            if (parentPageRef?.target && parentPageRef.target.pageID > 0) {
                parentIDArg = parentPageRef.target.pageID;
                // CRITICAL FIX: Set parentID in payload (not parentPageID)
                payload.parentPageID = parentPageRef.target.pageID;
                // Parent mapping successful (silent)
            } else {
                parentIDArg = -1;
                payload.parentPageID = -1; // No parent
                // Parent not found - using no parent (silent)
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

        // Map placeBeforePageItemID if present
        let placeBeforeIDArg = -1;
        if (payload.placeBeforePageItemID && payload.placeBeforePageItemID > 0) {
            const placeBeforePageRef = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', payload.placeBeforePageItemID);
            if (placeBeforePageRef?.target && placeBeforePageRef.target.pageID > 0) {
                placeBeforeIDArg = placeBeforePageRef.target.pageID;
            } else {
                placeBeforeIDArg = -1;
            }
        }

        // Save the page with returnBatchID flag for consistent batch processing
        const savePageResponse = await apiClient.pageMethods.savePage(payload, targetGuid, locale, parentIDArg, placeBeforeIDArg, true);

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
            const { pollBatchUntilComplete, extractBatchResults } = await import('../utilities/batch-polling');
            const completedBatch = await pollBatchUntilComplete(
                apiClient,
                batchID,
                targetGuid,
                [payload] // Pass payload for FIFO error matching
            );
            
            // Extract result from completed batch
            const { successfulItems: batchSuccessItems, failedItems: batchFailedItems } = extractBatchResults(completedBatch, [page]);
            
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
                    pageID: actualPageID
                } as mgmtApi.PageItem;
                referenceMapper.addRecord('page', page, createdPageData); // Use original page for source key
                
                if (existingPage) {
                    if (forceUpdate) {
                        console.log(`✓ Page ${ansiColors.underline(page.name)} ${ansiColors.bold.cyan('updated (forced)')} - ${ansiColors.green(targetGuid)}: ID:${actualPageID} (Template:${page.templateName || 'None'})`);
                    } else {
                        console.log(`✓ Page ${ansiColors.underline(page.name)} ${ansiColors.bold.cyan('updated')} - ${ansiColors.green(targetGuid)}: ID:${actualPageID} (Template:${page.templateName || 'None'})`);
                    }
                } else {
                    console.log(`✓ Page ${ansiColors.underline(page.name)} ${ansiColors.bold.green('created')} - ${ansiColors.green(targetGuid)}: ID:${actualPageID} (Template:${page.templateName || 'None'})`);
                }
                return true; // Success
            } else {
                // Show errorData if available, otherwise generic failure
                if (completedBatch.errorData && completedBatch.errorData.trim()) {
                    console.error(`✗ Page "${page.name}" failed - ${completedBatch.errorData}`);
                } else {
                    console.error(`✗ Page "${page.name}" failed - invalid page ID: ${actualPageID}`);
                }
                return false;
            }
        } else {
            console.error(`✗ Page "${page.name}" failed - unexpected response format`);
            return false; // Failure
        }

    } catch (error: any) {
        console.error(`✗ Page "${page.name}" failed - ${error.message}`);
        return false; // Failure
    }
}

export async function pushPages(
    pages: mgmtApi.PageItem[],
    sourceGuid: string,
    targetGuid: string,
    locale: string,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    forceUpdate: boolean = false,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successfulPages: number, failedPages: number }> {

    if (!pages || pages.length === 0) {
        console.log('No pages found to process.');
        return { status: 'success', successfulPages: 0, failedPages: 0 };
    }

    // Use simple legacy pattern - track processed pages directly
    const processedPages: { [oldPageId: number]: number } = {}; // oldPageId -> newPageId
    const processedContentIds: { [oldContentId: number]: number } = {}; // oldContentId -> newContentId

    // Extract content mappings from ReferenceMapper to legacy format
    const allContentMappings = referenceMapper.getRecordsByType('content');
    allContentMappings.forEach(mapping => {
        if (mapping.source?.contentID && mapping.target?.contentID) {
            processedContentIds[mapping.source.contentID] = mapping.target.contentID;
        }
    });

    let totalPages = pages.length;
    let processedPagesCount = 0;
    let successfulPages = 0;
    let failedPages = 0;
    let overallStatus: 'success' | 'error' = 'success';

    // NEW APPROACH: Use sitemap-based hierarchical ordering instead of simple parent/child filtering
    // Processing pages with hierarchical ordering (silent)
    
    let orderedPages: mgmtApi.PageItem[] = [];
    let depthInfo: Map<number, number> | null = null;
    
    try {
        // Import and use SitemapHierarchy for intelligent ordering
        const { SitemapHierarchy } = await import('../utilities/sitemap-hierarchy');
        
        // Use correct parameters for sitemap hierarchy - passed from calling context
        const rootPath = process.cwd() + '/agility-files';
        const isPreview = true; // Default assumption for sync operations
        
        // Using sourceGuid for hierarchy (silent)
        
        const sitemapHierarchy = new SitemapHierarchy(rootPath, sourceGuid, locale, isPreview, false);
        const sitemap = sitemapHierarchy.loadNestedSitemap();
        
        if (sitemap && sitemap.length > 0) {
            // Use sitemap hierarchy for intelligent ordering
            const hierarchy = sitemapHierarchy.buildPageHierarchy(sitemap);
            const orderingResult = sitemapHierarchy.getProcessingOrder(pages, hierarchy);
            
            orderedPages = orderingResult.orderedPages;
            depthInfo = orderingResult.depthInfo;
            
            // Validate processing order is dependency-safe
            const isValid = sitemapHierarchy.validateProcessingOrder(orderedPages, hierarchy);
            if (!isValid) {
                console.warn(`⚠️ [Hierarchy] Processing order validation failed - falling back to simple ordering`);
                throw new Error('Invalid processing order detected');
            }
            
            // Using sitemap-based depth ordering (silent)
        } else {
            throw new Error('No sitemap hierarchy available');
        }
    } catch (error: any) {
        console.warn(`⚠️ [Hierarchy] Sitemap-based ordering failed: ${error.message}`);
        console.warn(`📋 [Hierarchy] Falling back to simple parent/child ordering`);
        
        // Fallback to simple parent/child ordering (original logic)
        const getParentId = (page: any): number => {
            return page.parentPageID || -1;
        };
        
        const parentPages = pages.filter(p => {
            const parentPageID = getParentId(p);
            return !parentPageID || parentPageID <= 0;
        });
        const childPages = pages.filter(p => {
            const parentPageID = getParentId(p);
            return parentPageID && parentPageID > 0;
        });
        
        // Simple ordering: parents first, then children
        orderedPages = [...parentPages, ...childPages];
        // Using fallback ordering (silent)
    }

    // Process all pages in the calculated order
    for (let i = 0; i < orderedPages.length; i++) {
        const page = orderedPages[i];
        
        // Determine if this is a child page (has parent)
        const parentPageID = page.parentPageID || -1;
        const isChildPage = parentPageID > 0;
        
        const success = await processPage(page, targetGuid, locale, isChildPage, apiClient, referenceMapper, forceUpdate);
        if (success) {
            successfulPages++;
        } else {
            failedPages++;
            overallStatus = 'error';
        }
        processedPagesCount++;
        if (onProgress && typeof onProgress === 'function') {
            onProgress(processedPagesCount, totalPages, success ? 'success' : 'error');
        }
    }

    console.log(`Processed ${successfulPages}/${totalPages} pages (${failedPages} failed)`);
    return { status: overallStatus, successfulPages, failedPages };
}

// LEGACY-STYLE PAGE PROCESSING (DEPRECATED - use processPage instead)
async function processPageLegacy(
    page: mgmtApi.PageItem,
    targetGuid: string,
    locale: string,
    isChildPage: boolean,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper
): Promise<boolean> {
    try {
        const pageName = page.name;
        const pageId = page.pageID;
        let parentPageID = -1;

        // Create a copy to avoid modifying original
        let pageToProcess = JSON.parse(JSON.stringify(page));

        // Check if page already exists using getPageByID (much faster than sitemap lookup)
        let existingPage: mgmtApi.PageItem | null = null;
        let channelID = 1; // Default to website channel
        
        try {
            existingPage = await apiClient.pageMethods.getPage(pageId, targetGuid, locale);
        } catch (error: any) {
            // Page doesn't exist, will create new
            existingPage = null;
        }

        // Handle child pages - map parent ID using reference mapper
        if (isChildPage) {
            const parentMapping = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', page.parentPageID);
            if (parentMapping?.target) {
                parentPageID = parentMapping.target.pageID;
                pageToProcess.parentPageID = parentPageID;
            } else {
                return false; // Can't process child without parent
            }
        }

        // Map template ID if page has a template
        if (pageToProcess.pageTemplateID && pageToProcess.pageTemplateID > 0) {
            // Look up template by source pageTemplateID
            const templateMapping = referenceMapper.getRecordsByType('template').find(record => 
                record.source?.pageTemplateID === pageToProcess.pageTemplateID
            );
            if (templateMapping && templateMapping.target) {
                pageToProcess.pageTemplateID = templateMapping.target.pageTemplateID;
            }
        }

        // Map content IDs in zones
        if (pageToProcess.zones) {
            const keys = Object.keys(pageToProcess.zones);
            const zones = pageToProcess.zones;

            for (let k = 0; k < keys.length; k++) {
                const zone = zones[keys[k]];
                for (let z = 0; z < zone.length; z++) {
                    const sourceContentId = zone[z].item.contentid || zone[z].item.contentId;

                    if (sourceContentId) {
                        // Use reference mapper to find content mapping
                        const contentMapping = referenceMapper.getContentMappingById(sourceContentId);
                        if (contentMapping?.target && (contentMapping.target as any).contentID) {
                            const targetContentId = (contentMapping.target as any).contentID;
                            // Map to target content ID - preserve original field name
                            if (zone[z].item.contentid !== undefined) {
                                zone[z].item.contentid = targetContentId;
                            } else if (zone[z].item.contentId !== undefined) {
                                zone[z].item.contentId = targetContentId;
                            }
                        }
                    }
                }
            }
        }

        // Prepare page for API call
        const oldPageId = pageToProcess.pageID;
        pageToProcess.pageID = existingPage ? existingPage.pageID : -1;
        pageToProcess.channelID = existingPage ? existingPage.channelID : channelID;

        // Ensure required fields
        if (!pageToProcess.zones) {
            pageToProcess.zones = {};
        }
        if (!pageToProcess.title || pageToProcess.title.trim() === '') {
            pageToProcess.title = pageToProcess.menuText || pageToProcess.name || 'Untitled Page';
        }
        if (pageToProcess.pageType === 'folder' || !pageToProcess.templateName || pageToProcess.templateName === '') {
            pageToProcess.pageTemplateID = null;
        }
        if (!pageToProcess.visible) {
            pageToProcess.visible = { menu: true, sitemap: true };
        }

        // Save page
        const createdPage = await apiClient.pageMethods.savePage(pageToProcess, targetGuid, locale, parentPageID, -1);

        // Handle response
        if (createdPage && Array.isArray(createdPage) && createdPage[0]) {
            // Simple array response [12345]
            if (createdPage[0] > 0) {
                const targetPageData = { pageID: createdPage[0], name: pageName };
                console.log(`✓ Page ${existingPage ? 'updated' : 'created'}: ${pageName} - Source: ${oldPageId} Target: ${createdPage[0]}`);
                
                // Add to reference mapper using the passed instance
                referenceMapper.addRecord('page', page, targetPageData);
                
                return true;
            }
        } else if (createdPage && typeof createdPage === 'object' && 'batchID' in createdPage) {
            // Batch response - extract page ID if completed
            const batchResponse = createdPage as any;
            
            if (batchResponse.batchState === 3) {
                if (batchResponse.errorData && batchResponse.errorData.trim()) {
                    console.log(`✗ Page failed: ${pageName} - ${batchResponse.errorData}`);
                    return false;
                } else if (batchResponse.items && Array.isArray(batchResponse.items)) {
                    const pageItem = batchResponse.items.find((item: any) => item.itemType === 1);
                    if (pageItem && pageItem.itemID > 0 && !pageItem.itemNull) {
                        const targetPageData = { pageID: pageItem.itemID, name: pageName };
                        console.log(`✓ Page ${existingPage ? 'updated' : 'created'}: ${pageName} - Source: ${oldPageId} Target: ${pageItem.itemID}`);
                        
                        // Add to reference mapper using the passed instance
                        referenceMapper.addRecord('page', page, targetPageData);
                        
                        return true;
                    }
                }
            }
            console.log(`✗ Page failed: ${pageName} - batch not completed or failed`);
            return false;
        }

        console.log(`✗ Page failed: ${pageName} - invalid response`);
        return false;

    } catch (error: any) {
        console.log(`✗ Page failed: ${page.name} - ${error.message}`);
        return false;
    }
}
