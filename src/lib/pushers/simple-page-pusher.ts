import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { ReferenceMapper } from '../reference-mapper';

/**
 * SIMPLIFIED PAGE PUSHER - LEGACY PATTERN
 * 
 * This follows the EXACT pattern from push_legacy.ts that achieved 97% success rate:
 * 1. pageID = -1 for new pages
 * 2. channelID = -1 to let API assign default  
 * 3. Simple content ID mapping in zones
 * 4. Simple API call with minimal parameters
 * 5. Simple response handling

 */



export async function pushPagesSimple(
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
    
    console.log(`[Simple Page Pusher] Processing ${pages.length} pages using legacy pattern...`);
    
    // Legacy pattern: track processed pages directly
    const processedPages: { [oldPageId: number]: number } = {}; // oldPageId -> newPageId
    
    // Extract content mappings from ReferenceMapper to legacy format
    const processedContentIds: { [oldContentId: number]: number } = {}; // oldContentId -> newContentId
    const allContentMappings = referenceMapper.getRecordsByType('content');
    allContentMappings.forEach(mapping => {
        if (mapping.source?.contentID && mapping.target?.contentID) {
            processedContentIds[mapping.source.contentID] = mapping.target.contentID;
        }
    });
    
    console.log(`[Simple Page Pusher] Starting with ${Object.keys(processedContentIds).length} content ID mappings`);
    if (Object.keys(processedContentIds).length === 0) {
        console.log(`⚠️ [Simple Page Pusher] WARNING: No content mappings found! Pages with content will likely fail.`);
        console.log(`💡 [Simple Page Pusher] TIP: Ensure content has been processed before pages (use correct dependency order).`);
    }
    
    let successfulPages = 0;
    let failedPages = 0;
    
    // LEGACY PATTERN: Process parent pages first, then child pages
    const parentPages = pages.filter(p => p.parentPageID <= 0); // -1 or 0 means root level
    const childPages = pages.filter(p => p.parentPageID > 0);    // Positive ID means has parent
    
    console.log(`[Simple Page Pusher] Processing ${parentPages.length} parent pages first...`);
    
    // Process parent pages
    for (let i = 0; i < parentPages.length; i++) {
        const success = await processPageSimple(
            parentPages[i], 
            targetGuid, 
            locale, 
            false, // not child page
            apiClient, 
            processedPages, 
            processedContentIds
        );
        
        if (success) {
            successfulPages++;
        } else {
            failedPages++;
        }
        
        onProgress?.(i + 1, parentPages.length, success ? 'success' : 'error');
    }
    
    console.log(`[Simple Page Pusher] Processing ${childPages.length} child pages...`);
    
    // Process child pages
    for (let j = 0; j < childPages.length; j++) {
        const success = await processPageSimple(
            childPages[j], 
            targetGuid, 
            locale, 
            true, // is child page
            apiClient, 
            processedPages, 
            processedContentIds
        );
        
        if (success) {
            successfulPages++;
        } else {
            failedPages++;
        }
        
        onProgress?.(parentPages.length + j + 1, pages.length, success ? 'success' : 'error');
    }
    
    // Update ReferenceMapper with successful page mappings
    Object.keys(processedPages).forEach(sourcePageIDStr => {
        const sourcePageID = parseInt(sourcePageIDStr);
        const targetPageID = processedPages[sourcePageID];
        const sourcePage = pages.find(p => p.pageID === sourcePageID);
        if (sourcePage) {
            const targetPage = { ...sourcePage, pageID: targetPageID };
            referenceMapper.addRecord('page', sourcePage, targetPage);
        }
    });
    
    const overallStatus = failedPages > 0 ? 'error' : 'success';
    
    console.log(`[Simple Page Pusher] Complete: ${successfulPages}/${pages.length} pages successful`);
    
    return { 
        status: overallStatus, 
        successfulPages, 
        failedPages 
    };
}

/**
 * EXACT LEGACY PATTERN from push_legacy.ts processPage method
 */
async function processPageSimple(
    page: mgmtApi.PageItem, 
    targetGuid: string, 
    locale: string, 
    isChildPage: boolean,
    apiClient: mgmtApi.ApiClient,
    processedPages: { [oldPageId: number]: number },
    processedContentIds: { [oldContentId: number]: number }
): Promise<boolean> {
    
    const pageName = page.name;
    const pageId = page.pageID;
    
    try {
        let parentPageID = -1;
        
        // Create a copy to avoid modifying original (legacy pattern)
        let pageToProcess = JSON.parse(JSON.stringify(page));
        
        // LEGACY PATTERN: Handle child pages
        if (isChildPage) {
            if (processedPages[page.parentPageID]) {
                parentPageID = processedPages[page.parentPageID];
                pageToProcess.parentPageID = parentPageID; // Update to target parent ID
                console.log(`[Simple] Mapped parent: Source ${page.parentPageID} -> Target ${parentPageID}`);
            } else {
                console.error(`[Simple] ✗ Parent page (Source ID: ${page.parentPageID}) not found for child page: ${page.name}`);
                return false; // Can't process child without parent
            }
        }
        
        // LEGACY PATTERN: Map content IDs in zones exactly like legacy code
        if (pageToProcess.zones) {
            const keys = Object.keys(pageToProcess.zones);
            const zones = pageToProcess.zones;
            
            for (let k = 0; k < keys.length; k++) {
                const zone = zones[keys[k]];
                for (let z = 0; z < zone.length; z++) {
                    // Check for contentId in zone item
                    if ('contentId' in zone[z].item) {
                        const sourceContentId = zone[z].item.contentId;
                        if (processedContentIds[sourceContentId]) {
                            zone[z].item.contentId = processedContentIds[sourceContentId];
                            console.log(`[Simple] ✅ Mapped content: ${sourceContentId} -> ${processedContentIds[sourceContentId]}`);
                        } else {
                            console.error(`[Simple] ✗ Content ID ${sourceContentId} not found in mappings for page ${page.name}`);
                            // Legacy pattern: log error but continue (don't fail entire page)
                        }
                    }
                }
            }
        }
        
        // LEGACY PATTERN: Prepare page exactly like legacy code (lines 404-406)
        const oldPageId = pageToProcess.pageID;
        pageToProcess.pageID = -1;        // Key insight: -1 means "create new"  
        pageToProcess.channelID = -1;     // Key insight: -1 means "default channel"
        
        console.log(`[Simple] Calling savePage for: ${pageName} (${isChildPage ? 'child' : 'parent'})`);
        console.log(`[Simple] Template: ${pageToProcess.templateName || 'None'}, Zones: ${Object.keys(pageToProcess.zones || {}).join(', ')}`);
        
        // LEGACY API CALL PATTERN - Exact same signature as legacy
        const createdPage = await apiClient.pageMethods.savePage(pageToProcess, targetGuid, locale, parentPageID, -1);
        
        // LEGACY RESPONSE HANDLING PATTERN
        if (createdPage && Array.isArray(createdPage) && createdPage[0]) {
            if (createdPage[0] > 0) {
                processedPages[oldPageId] = createdPage[0];
                console.log(`✓ ${isChildPage ? 'Child ' : ''}Page ${ansiColors.underline(pageName)} Created - Target ID: ${createdPage[0]}`);
                return true;
            } else {
                console.error(`[Simple] ✗ Invalid page ID returned for ${pageName}: ${createdPage[0]}`);
                return false;
            }
        } else {
            // Handle any other response format as failure (keep it simple)
            console.error(`[Simple] ✗ Unexpected response format for ${pageName}:`, JSON.stringify(createdPage, null, 2));
            return false;
        }
        
    } catch (error: any) {
        console.error(`[Simple] ✗ Error processing page ${pageName}:`, error.message);
        if (error.response?.data) {
            console.error(`[Simple] API Error Data:`, error.response.data);
        }
        return false;
    }
} 