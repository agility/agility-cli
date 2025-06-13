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
    let consecutiveApiErrors = 0; // Track consecutive API method errors

    while (attempts < maxAttempts) {
        try {
            // Get batch status - try different possible method names
            const batchStatus = await (apiClient as any).pageMethods?.getAsyncBatchStatus?.(batchID, targetGuid)
                || await (apiClient as any).utilityMethods?.getAsyncBatchStatus?.(batchID, targetGuid)
                || await (apiClient as any).utilityMethods?.getBatchStatus?.(batchID, targetGuid)
                || await (apiClient as any).utilityMethods?.getBatch?.(batchID, targetGuid);

            if (!batchStatus) {
                consecutiveApiErrors++;

                // FAIL FAST: If we get 3 consecutive "No batch status returned" errors,
                // the API method doesn't exist - stop wasting time
                if (consecutiveApiErrors >= 3) {
                    console.error(`[Batch Poll] ⚡ FAIL FAST: Batch status API unavailable after ${consecutiveApiErrors} attempts - aborting polling`);
                    return {
                        success: false,
                        batch: null,
                        error: `FAIL_FAST: Batch status API method not available - stopped after ${consecutiveApiErrors} consecutive API errors`
                    };
                }

                throw new Error('No batch status returned from API');
            }

            // Reset consecutive error counter on successful API call
            consecutiveApiErrors = 0;

            // FAIL FAST: Check for errorData immediately - don't wait for completion
            if (batchStatus.errorData && batchStatus.errorData.trim()) {
                console.error(`[Batch Poll] ⚡ FAIL FAST: Batch ${batchID} has errorData - failing immediately`);
                console.error(`[Batch Poll] ErrorData: ${batchStatus.errorData.substring(0, 500)}...`);
                return {
                    success: false,
                    batch: batchStatus,
                    error: `FAIL_FAST: Batch has errorData - ${batchStatus.errorData.substring(0, 200)}...`
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
            console.log(`[Batch Poll] Attempt ${attempts + 1}: Batch ${batchID} state=${batchStatus.batchState}, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            attempts++;

        } catch (error: any) {
            console.error(`[Batch Poll] Error checking batch status: ${error.message}`);

            // Check if this is the "No batch status returned" error
            if (error.message.includes('No batch status returned from API')) {
                consecutiveApiErrors++;

                // FAIL FAST: If we hit the API error limit, stop immediately
                if (consecutiveApiErrors >= 3) {
                    console.error(`[Batch Poll] ⚡ FAIL FAST: Batch status API unavailable after ${consecutiveApiErrors} attempts - aborting polling`);
                    return {
                        success: false,
                        batch: null,
                        error: `FAIL_FAST: Batch status API method not available - stopped after ${consecutiveApiErrors} consecutive API errors`
                    };
                }
            }

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
        console.error(`[Batch Extract] No items found in batch for page ${pageName}`);
        return -1;
    }

    console.log(`[Batch Extract] Looking for page "${pageName}" in ${batch.items.length} batch items`);

    // Look for the page in batch items
    for (const item of batch.items) {
        // itemType 1 = Page, check for valid page with actual ID
        if (item.itemType === 1) {
            console.log(`[Batch Extract] Found page item: ${item.itemTitle || 'No Title'} with ID ${item.itemID}, itemNull: ${item.itemNull}`);

            // Check if this is our page (match by title or if it's the only page)
            const isTargetPage = item.itemTitle === pageName ||
                (batch.items.filter(i => i.itemType === 1).length === 1);

            if (isTargetPage && item.itemID > 0 && !item.itemNull) {
                console.log(`[Batch Extract] ✅ Successfully extracted page ID: ${item.itemID} for ${pageName}`);
                return item.itemID;
            }
        }
    }

    console.error(`[Batch Extract] ❌ No valid page found in batch items for ${pageName}`);
    console.error(`[Batch Extract] Available items:`, batch.items.map(item => ({
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
        console.log(`[Zone Translation] No zones or template sections - using zones as-is`);
        return sourceZones || {}; // No template or sections, return as-is
    }

    const translatedZones: any = {};
    const sectionNames = targetTemplate.contentSectionDefinitions
        .sort((a, b) => (a.itemOrder || 0) - (b.itemOrder || 0)) // Sort by item order
        .map(def => def.pageItemTemplateReferenceName);

    console.log(`[Zone Translation] Template expects zones:`, sectionNames);

    // Map source zones to template section names in order
    const sourceZoneEntries = Object.entries(sourceZones);

    for (let i = 0; i < sourceZoneEntries.length && i < sectionNames.length; i++) {
        const [sourceZoneName, zoneContent] = sourceZoneEntries[i];
        const targetZoneName = sectionNames[i];
        translatedZones[targetZoneName] = zoneContent;

        console.log(`[Zone Translation] ✅ ${sourceZoneName} -> ${targetZoneName} (${Array.isArray(zoneContent) ? zoneContent.length : 0} modules)`);
    }

    // Handle extra source zones (map to remaining template sections)
    if (sourceZoneEntries.length > sectionNames.length) {
        console.log(`[Zone Translation] ⚠️ ${sourceZoneEntries.length - sectionNames.length} extra source zones ignored (no matching template sections)`);
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
        console.log(`[Page Debug] Starting page processing: ${page.name}`);
        console.log(`[Page Debug] Source page template: ${page.templateName || 'None (folder page)'}`);
        console.log(`[Page Debug] Source page type: ${page.pageType || 'standard'}`);
        console.log(`[Page Debug] Source page parent ID: ${page.parentPageID || 'None'}`);

        let targetTemplate: mgmtApi.PageModel | null = null;

        // Only try to find template mapping for non-folder pages
        if (page.pageType !== 'folder' && page.templateName) {
            // Find the template mapping
            let templateRef = referenceMapper.getMappingByKey<mgmtApi.PageModel>('template', 'pageTemplateName', page.templateName);
            if (!templateRef?.target) {
                console.error(`✗ Template ${page.templateName} not found or processed for page: ${page.name}`);
                console.log(`[Page Debug] Available template mappings:`, referenceMapper.getRecordsByType('template').map(r => `${r.source.pageTemplateName} -> ${r.target?.pageTemplateName || 'null'}`));
                return false;
            }
            targetTemplate = templateRef.target;
            console.log(`[Page Debug] ✓ Found template mapping: ${page.templateName} -> ${targetTemplate.pageTemplateName} (ID: ${targetTemplate.pageTemplateID})`);
        } else {
            console.log(`[Page Debug] ✓ Folder page - no template needed`);
        }

        // Get the sitemap to find existing page ID and channel ID
        const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);
        const websiteChannel = sitemap?.find(channel => channel.digitalChannelTypeName === 'Website');
        if (websiteChannel) {
            channelID = websiteChannel.digitalChannelID;
            console.log(`[Page Debug] Found website channel ID: ${channelID}`);
            const pageInSitemap = websiteChannel.pages.find(p =>
                p.pageName === page.name &&
                p.parentPageID === page.parentPageID &&
                p.pageType === page.pageType
            ); // Match name, parent, and page type to handle duplicates
            if (pageInSitemap) {
                correctPageID = pageInSitemap.pageID;
                console.log(`[Page Debug] Found existing page in sitemap: ${page.name} (ID: ${correctPageID})`);
                // Attempt to fetch the full existing page data
                try {
                    existingPage = await apiClient.pageMethods.getPage(correctPageID, targetGuid, locale);
                    console.log(`[Page Debug] Successfully fetched existing page data for ${page.name}`);
                } catch (fetchError: any) {
                    if (!(fetchError.response && fetchError.response.status === 404)) {
                        console.warn(`Warning: Could not fetch existing page ${correctPageID} for ${page.name}: ${fetchError.message}`);
                    }
                    // If fetch fails (e.g., 404), existingPage remains null, proceed to create
                }
            } else {
                // Debug: Check if there are pages with same name but different type
                const sameNamePages = websiteChannel.pages.filter(p => p.pageName === page.name);
                if (sameNamePages.length > 0) {
                    console.log(`[Page Debug] Found ${sameNamePages.length} pages with name "${page.name}" but no exact match:`);
                    sameNamePages.forEach(p => console.log(`  - ID: ${p.pageID}, Type: ${p.pageType || 'unknown'}, Parent: ${p.parentPageID}`));
                    console.log(`[Page Debug] Looking for: Type: ${page.pageType || 'unknown'}, Parent: ${page.parentPageID}`);
                }
                console.log(`[Page Debug] Page ${page.name} not found in target sitemap - will create new`);
            }
        } else {
            console.log(`[Page Debug] No website channel found in target sitemap`);
        }

        // Map Content IDs in Zones
        // Handle folder pages which may not have zones
        let sourceZones = page.zones ? { ...page.zones } : {}; // Clone zones or use empty object

        // CRITICAL: Translate zone names to match template expectations BEFORE content mapping
        let mappedZones = translateZoneNames(sourceZones, targetTemplate);
        let mappingSuccessful = true;

        console.log(`[Page Debug] Original zones for ${page.name}:`, JSON.stringify(page.zones, null, 2));
        console.log(`[Page Debug] Translated zones for ${page.name}:`, JSON.stringify(mappedZones, null, 2));

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
                                // Map to target content ID
                                newModule.item = {
                                    ...module.item,
                                    contentid: (contentRef.target as any).contentID, // Use lowercase to match format
                                    contentId: (contentRef.target as any).contentID,  // Also set camelCase for compatibility
                                    fulllist: module.item.fulllist
                                };
                                console.log(`[Page Debug] ✅ Mapped module ${module.module}: content ${sourceContentId} -> ${(contentRef.target as any).contentID}`);
                            } else {
                                console.log(`[Page Debug] ❌ No content mapping found for ${module.module}: contentID ${sourceContentId}`);

                                // Debug content mapping issues
                                const contentMappings = referenceMapper.getRecordsByType('content');
                                console.log(`[Page Debug] Total content mappings available: ${contentMappings.length}`);
                                console.log(`[Page Debug] Sample valid content mappings:`, contentMappings.filter(r => r.target && r.target.contentID > 0).slice(0, 5).map(r => ({
                                    sourceID: r.source.contentID,
                                    targetID: r.target.contentID,
                                    sourceRef: r.source.properties?.referenceName,
                                    targetRef: r.target.properties?.referenceName
                                })));

                                console.log(`[Page Debug] Sample failed content mappings:`, contentMappings.filter(r => !r.target || r.target.contentID <= 0).slice(0, 5).map(r => ({
                                    sourceID: r.source.contentID,
                                    targetID: r.target?.contentID || null,
                                    sourceRef: r.source.properties?.referenceName,
                                    targetRef: r.target?.properties?.referenceName || null,
                                    reason: !r.target ? 'no target' : 'target contentID <= 0'
                                })));

                                // Check if this content ID exists in any mapping
                                const allContentRecords = referenceMapper.getRecordsByType('content');
                                const matchingRecord = allContentRecords.find(r => r.source.contentID === sourceContentId);
                                if (matchingRecord) {
                                    console.log(`[Page Debug] Found matching source record but issue with target:`, {
                                        sourceID: matchingRecord.source.contentID,
                                        targetID: matchingRecord.target?.contentID,
                                        hasTarget: !!matchingRecord.target
                                    });
                                } else {
                                    console.log(`[Page Debug] No record found with source contentID: ${sourceContentId}`);
                                }

                                // Skip this module instead of failing the whole page
                                console.log(`[Page Debug] ⚠ Skipping unmapped module ${module.module} for ${page.name}`);
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

        // Allow folder pages to have no modules since they don't need content
        // Also allow existing pages with no modules to succeed (they may have been manually created/cleared)
        if (totalModules === 0 && page.pageType !== 'folder') {
            // If the page already exists in target, allow it to proceed even with no modules
            if (existingPage) {
                console.log(`⚠ Page ${page.name} has no valid modules but exists in target - proceeding with update (may have been manually created/cleared)`);
            } else {
                // Analyze why this page has no valid modules
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

        // Map parent page ID if present
        let parentIDArg = -1;
        if (payload.parentPageID && payload.parentPageID > 0) {
            const parentPageRef = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', payload.parentPageID);
            if (parentPageRef?.target && parentPageRef.target.pageID > 0) {
                parentIDArg = parentPageRef.target.pageID;
                console.log(`[Page Debug] Mapped parent page ID: ${payload.parentPageID} -> ${parentIDArg}`);
            } else {
                console.log(`[Page Debug] ⚠ Parent page ID ${payload.parentPageID} not found in reference mapper - using -1 (no parent)`);
                parentIDArg = -1;
            }
        }

        // Map placeBeforePageItemID if present
        let placeBeforeIDArg = -1;
        if (payload.placeBeforePageItemID && payload.placeBeforePageItemID > 0) {
            const placeBeforePageRef = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', payload.placeBeforePageItemID);
            if (placeBeforePageRef?.target && placeBeforePageRef.target.pageID > 0) {
                placeBeforeIDArg = placeBeforePageRef.target.pageID;
                console.log(`[Page Debug] Mapped placeBeforePageItemID: ${payload.placeBeforePageItemID} -> ${placeBeforeIDArg}`);
            } else {
                console.log(`[Page Debug] ⚠ PlaceBeforePageItemID ${payload.placeBeforePageItemID} not found in reference mapper - using -1`);
                placeBeforeIDArg = -1;
            }
        }

        console.log(`[Page Debug] Processing page: ${page.name}`);
        console.log(`[Page Debug] Template: ${page.templateName || 'None (folder)'} -> Target ID: ${targetTemplate ? targetTemplate.pageTemplateID : 'None'}`);
        console.log(`[Page Debug] Existing page: ${existingPage ? `Yes (ID: ${existingPage.pageID})` : 'No'}`);
        console.log(`[Page Debug] Channel ID: ${channelID}`);
        console.log(`[Page Debug] Parent ID: ${parentIDArg}`);
        console.log(`[Page Debug] Payload zones:`, JSON.stringify(mappedZones, null, 2));

        // Save the page
        const savePageResponse = await apiClient.pageMethods.savePage(payload, targetGuid, locale, parentIDArg, placeBeforeIDArg);

        console.log(`[Page Debug] API Response for ${page.name}:`, JSON.stringify(savePageResponse, null, 2));

        // Process the response
        if (Array.isArray(savePageResponse) && savePageResponse.length > 0 && savePageResponse[0] > 0) {
            const newPageID = savePageResponse[0];
            const createdPageData = {
                ...payload, // Use the payload data which has mapped zones
                pageID: newPageID
            } as mgmtApi.PageItem;
            referenceMapper.addRecord('page', page, createdPageData); // Use original page for source key
            console.log(`✓ ${isChildPage ? 'Child ' : ''}Page ${ansiColors.underline(page.name)} ${existingPage ? 'Updated' : 'Created'} - Target ID: ${newPageID}`);
            console.log(`[Page Debug] Added page mapping: Source pageID ${page.pageID} -> Target pageID ${newPageID}`);
            return true; // Success
        } else if (savePageResponse && typeof savePageResponse === 'object' && 'batchID' in savePageResponse) {
            // Handle batch processing response - POLL FOR COMPLETION
            const batchResponse = savePageResponse as any;
            console.log(`[Page Debug] Batch response for ${page.name}: batchID ${batchResponse.batchID}, state: ${batchResponse.batchState}`);

            if (batchResponse.batchID) {
                console.log(`[Page Debug] Polling batch ${batchResponse.batchID} for completion...`);

                // Poll batch status until completion
                const completedBatch = await pollBatchStatus(apiClient, batchResponse.batchID, targetGuid);

                if (completedBatch.success) {
                    console.log(`[Page Debug] Batch ${batchResponse.batchID} completed successfully`);

                    // Extract actual page ID from completed batch
                    const actualPageID = extractPageIDFromBatch(completedBatch.batch, page.name);

                    if (actualPageID > 0) {
                        console.log(`✓ ${isChildPage ? 'Child ' : ''}Page ${ansiColors.underline(page.name)} ${existingPage ? 'Updated' : 'Created'} - Target ID: ${actualPageID}`);
                        const pageData = {
                            ...payload,
                            pageID: actualPageID
                        } as mgmtApi.PageItem;
                        referenceMapper.addRecord('page', page, pageData);
                        console.log(`[Page Debug] Added page mapping: Source pageID ${page.pageID} -> Target pageID ${actualPageID}`);
                        return true;
                    } else {
                        console.error(`✗ Failed to extract page ID from completed batch for ${page.name}`);
                        console.error(`[Page Debug] Batch items:`, JSON.stringify(completedBatch.batch.items, null, 2));
                        return false;
                    }
                } else {
                    console.error(`✗ Batch ${batchResponse.batchID} failed for page ${page.name}: ${completedBatch.error}`);
                    console.error(`[Page Debug] Batch error details:`, JSON.stringify(completedBatch.batch, null, 2));
                    return false;
                }
            } else {
                console.error(`✗ No batch ID received for page ${page.name}`);
                return false;
            }
        } else if (savePageResponse && typeof savePageResponse === 'object' && 'errorData' in savePageResponse) {
            // Handle API error response object
            console.error(`✗ Failed to ${existingPage ? 'update' : 'create'} page ${page.name}`);
            const wrapped = wrapLines(savePageResponse.errorData, 80);
            console.error(ansiColors.red(`API Error: ${wrapped}`));
            console.error('[Page Debug] Full API Error Response:', JSON.stringify(savePageResponse, null, 2));
            console.error('[Page Debug] Payload that caused error:', JSON.stringify(payload, null, 2));
            return false; // Failure
        } else {
            // Handle unexpected response format
            console.error(`✗ Unexpected response when saving page ${page.name}:`, savePageResponse);
            console.error('[Page Debug] Full unexpected response:', JSON.stringify(savePageResponse, null, 2));
            console.error('[Page Debug] Payload that caused unexpected response:', JSON.stringify(payload, null, 2));
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
    let parentPages = pages.filter(p => !p.parentPageID || p.parentPageID < 0);
    let childPages = pages.filter(p => p.parentPageID && p.parentPageID > 0);

    // Process parent pages first
    for (let i = 0; i < parentPages.length; i++) {
        const page = parentPages[i];

        const success = await processPageLegacy(page, targetGuid, locale, false, apiClient, processedPages, processedContentIds, referenceMapper);
        if (success) {
            successfulPages++;
        } else {
            failedPages++;
            overallStatus = 'error';
        }
        processedPagesCount++;
        if (onProgress) {
            onProgress(processedPagesCount, totalPages, success ? 'success' : 'error');
        }
    }

    // Process child pages with dependency resolution
    let remainingChildPages = childPages.filter(p => !processedPages[p.pageID]);
    while (remainingChildPages.length > 0) {
        const currentChildPages = remainingChildPages.slice(); // Copy current state
        for (let i = 0; i < currentChildPages.length; i++) {
            const page = currentChildPages[i];

            //check if the page's parent has been processed
            if (!processedPages[page.parentPageID]) continue;

            const success = await processPageLegacy(page, targetGuid, locale, true, apiClient, processedPages, processedContentIds, referenceMapper);
            if (success) {
                successfulPages++;
            } else {
                failedPages++;
                overallStatus = 'error';
            }
            processedPagesCount++;
            if (onProgress) {
                onProgress(processedPagesCount, totalPages, success ? 'success' : 'error');
            }
            // If this child page was processed successfully, remove it from remaining list
            if (success) {
                remainingChildPages = remainingChildPages.filter(p => p.pageID !== page.pageID);
            }
        }

        // If no child pages were processed in this pass, break to avoid infinite loop
        if (remainingChildPages.length === currentChildPages.length) {
            break;
        }
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
