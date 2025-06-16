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
    referenceMapper: ReferenceMapper
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

        // Get the sitemap to find existing page ID and channel ID
        const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);
        const websiteChannel = sitemap?.find(channel => channel.digitalChannelTypeName === 'Website');
        if (websiteChannel) {
            channelID = websiteChannel.digitalChannelID;
            // CRITICAL FIX: Match by page ID - most reliable way to find existing pages
            const pageInSitemap = websiteChannel.pages.find(p => p.pageID === page.pageID);
            if (pageInSitemap) {
                correctPageID = pageInSitemap.pageID;
                console.log(`[Existing Page] Found existing page "${page.name}" with ID ${correctPageID}`);
                // Attempt to fetch the full existing page data
                try {
                    existingPage = await apiClient.pageMethods.getPage(correctPageID, targetGuid, locale);
                } catch (fetchError: any) {
                    if (!(fetchError.response && fetchError.response.status === 404)) {
                        console.warn(`Warning: Could not fetch existing page ${correctPageID} for ${page.name}: ${fetchError.message}`);
                    }
                    // If fetch fails (e.g., 404), existingPage remains null, proceed to create
                }
            } else {
                console.log(`[New Page] Page "${page.name}" (ID: ${page.pageID}) not found in target - will create new`);
            }
        }

        // Map Content IDs in Zones
        // Handle folder pages which may not have zones
        let sourceZones = page.zones ? { ...page.zones } : {}; // Clone zones or use empty object

        // CRITICAL: Translate zone names to match template expectations BEFORE content mapping
        let mappedZones = translateZoneNames(sourceZones, targetTemplate);

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
            if (isLegitimateEmptyPage(page)) {
                // This is a legitimate empty page (folder, link, redirect, dynamic, etc.) - proceed normally
                const pageAny = page as any;
                let pageTypeDescription = page.pageType || 'unknown';
                if (pageAny.dynamic && pageAny.dynamic.referenceName) {
                    pageTypeDescription = 'dynamic';
                } else if (pageAny.dynamicPageContentViewReferenceName) {
                    pageTypeDescription = 'dynamic';
                } else if (pageAny.redirectUrl || (pageAny.redirect && pageAny.redirect.url)) {
                    pageTypeDescription = 'redirect';
                } else if (pageAny.linkToFileID || pageAny.linkToPageID || pageAny.linkToFile || pageAny.linkToPage) {
                    pageTypeDescription = 'link';
                }
                console.log(`✓ Page ${page.name} has no modules - this is normal for ${pageTypeDescription} pages`);
            } else if (existingPage) {
                // Page exists in target but has no modules - allow update (may have been manually cleared)
                console.log(`⚠ Page ${page.name} has no valid modules but exists in target - proceeding with update (may have been manually created/cleared)`);
            } else {
                // This appears to be a content page that lost its modules during mapping - investigate
                const originalZones = page.zones || {};
                let originalModuleCount = 0;
                let skippedModules = 0;
                let nullModules = 0;

                for (const [zoneName, zoneModules] of Object.entries(originalZones)) {
                    if (Array.isArray(zoneModules)) {
                        originalModuleCount += zoneModules.length;

                        for (const module of zoneModules) {
                            if (!module.item || module.item.contentId === null || module.item.contentId === undefined) {
                                nullModules++;
                            } else {
                                const contentRef = referenceMapper.getContentMappingById(module.item.contentId);
                                if (contentRef?.target && (contentRef.target as any).contentID === -1) {
                                    skippedModules++;
                                }
                            }
                        }
                    }
                }

                
                console.error(`✗ Page ${page.name} has no valid modules after content mapping. Original: ${originalModuleCount}, Failed content: ${skippedModules}, Null modules: ${nullModules}. ${skippedModules > 0 ? 'Content failures likely due to missing assets.' : ''}`);
                return false;
            }
        }

        // Prepare payload - ensure proper null handling
        // Fix zones format - ensure zones is always a defined object (never null/undefined)
        const formattedZones = mappedZones && typeof mappedZones === 'object' ? mappedZones : {};

        // CRITICAL FIX: Ensure every page has a valid title field
        // Folder pages often don't have titles, but API requires them
        const pageTitle = page.title || page.menuText || page.name || "Untitled Page";

        const payload = {
            ...page,
            pageID: existingPage ? existingPage.pageID : -1,
            title: pageTitle, // CRITICAL: Ensure title is always present
            pageTemplateID: targetTemplate ? targetTemplate.pageTemplateID : null, // null for folder pages
            channelID: channelID > 0 ? channelID : (existingPage ? existingPage.channelID : -1), // Use found channel ID or existing
            zones: formattedZones,
            // Ensure scripts have proper string values instead of null
            scripts: {
                excludedFromGlobal: page.scripts?.excludedFromGlobal || false,
                top: page.scripts?.top || "",
                bottom: page.scripts?.bottom || ""
            },
            // Ensure visible properties are properly set
            visible: {
                menu: page.visible?.menu !== false, // Default to true unless explicitly false
                sitemap: page.visible?.sitemap !== false // Default to true unless explicitly false
            },
            // Remove potentially problematic fields for new page creation
            ...(existingPage ? {} : {
                // For new pages, remove fields that might cause validation issues
                properties: undefined,  // Remove properties with state and versionID
                modified: undefined,    // Remove timestamps
                versionID: undefined,   // Remove version tracking
                // Clean up dynamic page configuration
                dynamic: page.dynamic ? {
                    referenceName: page.dynamic.referenceName,
                    fieldName: page.dynamic.fieldName || "",
                    titleFormula: null,
                    menuTextFormula: null,
                    pageNameFormula: null,
                    visibleOnMenu: null,
                    visibleOnSitemap: null
                } : undefined
            })
        };

        // Map parent page ID if present - CRITICAL: Update both parentIDArg AND payload.parentPageID
        let parentIDArg = -1;
        // CRITICAL FIX: Handle both parentID and parentPageID field names
        const sourceParentId = payload.parentPageID || (payload as any).parentID;
        if (sourceParentId && sourceParentId > 0) {
            const parentPageRef = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourceParentId);
            if (parentPageRef?.target && parentPageRef.target.pageID > 0) {
                parentIDArg = parentPageRef.target.pageID;
                // CRITICAL FIX: Update the payload's parentPageID to the target parent ID
                payload.parentPageID = parentPageRef.target.pageID;
                console.log(`[Parent Mapping] ${page.name}: source parent ${sourceParentId} -> target parent ${parentIDArg}`);
            } else {
                parentIDArg = -1;
                payload.parentPageID = -1; // No parent
                console.log(`[Parent Mapping] ${page.name}: parent ${sourceParentId} not found in mappings - using no parent`);
            }
        } else {
            payload.parentPageID = -1; // Ensure no parent
        }

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

        // Save the page
        const savePageResponse = await apiClient.pageMethods.savePage(payload, targetGuid, locale, parentIDArg, placeBeforeIDArg);

        // Process the response
        if (Array.isArray(savePageResponse) && savePageResponse.length > 0 && savePageResponse[0] > 0) {
            const newPageID = savePageResponse[0];
            const createdPageData = {
                ...payload, // Use the payload data which has mapped zones
                pageID: newPageID
            } as mgmtApi.PageItem;
            referenceMapper.addRecord('page', page, createdPageData); // Use original page for source key
            console.log(`✓ ${isChildPage ? 'Child ' : ''}Page ${ansiColors.underline(page.name)} ${existingPage ? 'Updated' : 'Created'} - Target ID: ${newPageID}`);
            return true; // Success
        } else if (savePageResponse && typeof savePageResponse === 'object' && 'batchID' in savePageResponse) {
            // Handle batch processing response - POLL FOR COMPLETION
            const batchResponse = savePageResponse as any;

            if (batchResponse.batchID) {
                // Poll batch status until completion
                const completedBatch = await pollBatchStatus(apiClient, batchResponse.batchID, targetGuid);

                if (completedBatch.success) {
                    // Extract actual page ID from completed batch
                    const actualPageID = extractPageIDFromBatch(completedBatch.batch, page.name);

                    if (actualPageID > 0) {
                        console.log(`✓ ${isChildPage ? 'Child ' : ''}Page ${ansiColors.underline(page.name)} ${existingPage ? 'Updated' : 'Created'} - Target ID: ${actualPageID}`);
                        const pageData = {
                            ...payload,
                            pageID: actualPageID
                        } as mgmtApi.PageItem;
                        referenceMapper.addRecord('page', page, pageData);
                        return true;
                    } else {
                        console.error(`✗ Failed to extract page ID from completed batch for ${page.name}`);
                        console.error(`Batch response:`, JSON.stringify(batchResponse, null, 2));
                        console.error(`Payload sent:`, JSON.stringify(payload, null, 2));
                        return false;
                    }
                } else {
                    console.error(`✗ Batch ${batchResponse.batchID} failed for page ${page.name}: ${completedBatch.error}`);
                    console.error(`Payload sent:`, JSON.stringify(payload, null, 2));
                    if (completedBatch.batch) {
                        console.error(`Batch error details:`, JSON.stringify(completedBatch.batch, null, 2));
                    }
                    return false;
                }
            } else {
                console.error(`✗ No batch ID received for page ${page.name}`);
                console.error(`API response:`, JSON.stringify(savePageResponse, null, 2));
                console.error(`Payload sent:`, JSON.stringify(payload, null, 2));
                return false;
            }
        } else if (savePageResponse && typeof savePageResponse === 'object' && 'errorData' in savePageResponse) {
            // Handle API error response object
            console.error(`✗ Failed to ${existingPage ? 'update' : 'create'} page ${page.name}`);
            const wrapped = wrapLines(savePageResponse.errorData, 80);
            console.error(ansiColors.red(`API Error: ${wrapped}`));
            console.error('API Error Response:', JSON.stringify(savePageResponse, null, 2));
            console.error('Payload that caused error:', JSON.stringify(payload, null, 2));
            return false; // Failure
        } else {
            // Handle unexpected response format
            console.error(`✗ Unexpected response when saving page ${page.name}:`, savePageResponse);
            console.error('Unexpected response:', JSON.stringify(savePageResponse, null, 2));
            console.error('Payload that caused unexpected response:', JSON.stringify(payload, null, 2));
            return false; // Failure
        }

    } catch (error: any) {
        console.error(`✗ Error processing page ${page.name}:`, error.message);
        if (error.response?.data) {
            console.error('API Response Data:', error.response.data);
        }
        return false; // Failure
    }
}

export async function pushPages(
    pages: mgmtApi.PageItem[],
    targetGuid: string,
    locale: string,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
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

    // Process parent pages first, then child pages
    // CRITICAL FIX: Handle both parentID and parentPageID field names
    // Analysis data uses parentID, sitemap uses parentPageID
    const getParentId = (page: any): number => {
        return page.parentPageID || (page as any).parentID || -1;
    };
    
    let parentPages = pages.filter(p => {
        const parentId = getParentId(p);
        return !parentId || parentId <= 0;
    });
    let childPages = pages.filter(p => {
        const parentId = getParentId(p);
        return parentId && parentId > 0;
    });

    // DEBUG: Check page filtering
    console.log(`[Page Filter Debug] Total pages: ${pages.length}`);
    console.log(`[Page Filter Debug] Parent pages: ${parentPages.length}`);
    console.log(`[Page Filter Debug] Child pages: ${childPages.length}`);
    
    // DEBUG: Sample a few pages to see their parentPageID values
    pages.slice(0, 5).forEach(page => {
        const parentId = getParentId(page);
        console.log(`[Page Filter Debug] Page "${page.name}": parentID = ${parentId} (parentPageID: ${page.parentPageID}, parentID: ${(page as any).parentID})`);
    });
    
    if (childPages.length > 0) {
        console.log(`[Page Filter Debug] Sample child pages:`);
        childPages.slice(0, 3).forEach(page => {
            const parentId = getParentId(page);
            console.log(`  - "${page.name}" has parent ${parentId}`);
        });
    }

    // Helper function to check if a parent page has been processed using ReferenceMapper
    const isParentProcessed = (parentPageID: number): boolean => {
        const parentPageRecord = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', parentPageID);
        return !!(parentPageRecord?.target && parentPageRecord.target.pageID > 0);
    };

    // Process parent pages first
    for (let i = 0; i < parentPages.length; i++) {
        const page = parentPages[i];

        const success = await processPage(page, targetGuid, locale, false, apiClient, referenceMapper);
        if (success) {
            successfulPages++;
            // Update legacy processedPages tracking for backward compatibility
            const pageRecord = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', page.pageID);
            if (pageRecord?.target) {
                processedPages[page.pageID] = pageRecord.target.pageID;
            }
        } else {
            failedPages++;
            overallStatus = 'error';
        }
        processedPagesCount++;
        if (onProgress && typeof onProgress === 'function') {
            onProgress(processedPagesCount, totalPages, success ? 'success' : 'error');
        }
    }

    // Process child pages with dependency resolution using ReferenceMapper
    let remainingChildPages = [...childPages]; // Start with all child pages
    let maxAttempts = 5; // Prevent infinite loops
    let attempt = 0;
    
    while (remainingChildPages.length > 0 && attempt < maxAttempts) {
        attempt++;
        console.log(`\n[Child Page Processing] Attempt ${attempt}: Processing ${remainingChildPages.length} remaining child pages`);
        
        const currentChildPages = remainingChildPages.slice(); // Copy current state
        let progressMade = false;
        
        for (let i = 0; i < currentChildPages.length; i++) {
            const page = currentChildPages[i];

            // Check if the page's parent has been processed using ReferenceMapper
            const parentId = getParentId(page);
            if (!isParentProcessed(parentId)) {
                console.log(`[Child Page Debug] Skipping "${page.name}" - parent ${parentId} not yet processed`);
                continue; // Skip this page, parent not ready yet
            }

            console.log(`[Child Page Debug] Processing "${page.name}" - parent ${parentId} is ready`);
            const success = await processPage(page, targetGuid, locale, true, apiClient, referenceMapper);
            if (success) {
                successfulPages++;
                // Update legacy processedPages tracking for backward compatibility
                const pageRecord = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', page.pageID);
                if (pageRecord?.target) {
                    processedPages[page.pageID] = pageRecord.target.pageID;
                }
                // Remove from remaining list
                remainingChildPages = remainingChildPages.filter(p => p.pageID !== page.pageID);
                progressMade = true;
                console.log(`[Child Page Debug] Successfully processed "${page.name}" - ${remainingChildPages.length} child pages remaining`);
            } else {
                failedPages++;
                overallStatus = 'error';
                console.log(`[Child Page Debug] Failed to process "${page.name}"`);
            }
            processedPagesCount++;
            if (onProgress && typeof onProgress === 'function') {
                onProgress(processedPagesCount, totalPages, success ? 'success' : 'error');
            }
        }

        // If no child pages were processed in this pass, break to avoid infinite loop
        if (!progressMade) {
            console.warn(`[Child Page Processing] No progress made in attempt ${attempt}. ${remainingChildPages.length} child pages could not be processed.`);
            break;
        } else {
            console.log(`[Child Page Processing] Attempt ${attempt} complete. Progress made: ${currentChildPages.length - remainingChildPages.length} pages processed.`);
        }
    }
    
    // Report any remaining unprocessed child pages
    if (remainingChildPages.length > 0) {
        console.warn(`Warning: ${remainingChildPages.length} child pages could not be processed after ${attempt} attempts:`);
        remainingChildPages.forEach(page => {
            const parentId = getParentId(page);
            console.warn(`  - Page "${page.name}" (ID: ${page.pageID}) waiting for parent ${parentId}`);
            failedPages++;
            overallStatus = 'error';
        });
    }

    console.log(`Processed ${successfulPages}/${totalPages} pages (${failedPages} failed)`);
    return { status: overallStatus, successfulPages, failedPages };
}

// LEGACY-STYLE PAGE PROCESSING
async function processPageLegacy(
    page: mgmtApi.PageItem,
    targetGuid: string,
    locale: string,
    isChildPage: boolean,
    apiClient: mgmtApi.ApiClient,
    processedPages: { [oldPageId: number]: number },
    processedContentIds: { [oldContentId: number]: number },
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

        // Handle child pages - map parent ID
        if (isChildPage) {
            if (processedPages[page.parentPageID]) {
                parentPageID = processedPages[page.parentPageID];
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

                    if (sourceContentId && processedContentIds[sourceContentId]) {
                        // Map to target content ID - preserve original field name
                        if (zone[z].item.contentid !== undefined) {
                            zone[z].item.contentid = processedContentIds[sourceContentId];
                        } else if (zone[z].item.contentId !== undefined) {
                            zone[z].item.contentId = processedContentIds[sourceContentId];
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
                processedPages[oldPageId] = createdPage[0];
                console.log(`✓ Page ${existingPage ? 'updated' : 'created'}: ${pageName} - Source: ${oldPageId} ${targetGuid}: ${createdPage[0]}`);
                
                // Add to reference mapper using the passed instance
                referenceMapper.addRecord('page', page, { pageID: createdPage[0], name: pageName });
                
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
                        processedPages[oldPageId] = pageItem.itemID;
                        console.log(`✓ Page ${existingPage ? 'updated' : 'created'}: ${pageName} - Source: ${oldPageId} ${targetGuid}: ${pageItem.itemID}`);
                        
                        // Add to reference mapper using the passed instance
                        referenceMapper.addRecord('page', page, { pageID: pageItem.itemID, name: pageName });
                        
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
