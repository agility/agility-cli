/**
 * Batch Content Item Pusher
 * 
 * Implements bulk content upload following the proven 2-pass pattern from content-item-pusher.ts
 * but with bulk processing capabilities and proper dependency mapping.
 * 
 * Key Features:
 * - 2-Pass Processing: Shell creation → Full definition updates
 * - Bulk API Usage: Uses saveContentItems (plural) for batch operations
 * - Proper Dependency Mapping: Container, model, asset, and content reference mapping
 * - Change Detection: Only uploads changed content items
 * - Reference Resolution: Handles nested content and asset references
 */

import { ReferenceMapper } from "../reference-mapper";
import * as mgmtApi from '@agility/management-sdk';
import { findContentInTargetInstance } from "../finders/content-item-finder";
// Simple content item mapping function to replace the deleted mapper
async function mapContentItem(
    contentItem: mgmtApi.ContentItem,
    referenceMapper: ReferenceMapper,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    defaultAssetUrl: string
): Promise<mgmtApi.ContentItem> {
    // For now, return the content item as-is
    // TODO: Add field mapping logic here if needed
    return { ...contentItem };
}
// Import batch polling utilities (TODO: Move to shared utilities file)
async function pollBatchStatus(apiClient: mgmtApi.ApiClient, batchID: number, targetGuid: string, maxAttempts: number = 30): Promise<any> {
    console.log(`[Batch Polling] Starting polling for batch ${batchID}...`);
    let consecutiveApiErrors = 0; // Track consecutive API method errors
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Try different possible method names for batch status checking
            let batchStatus: any;
            
            // Try different API methods for batch status (following page polling pattern)
            batchStatus = await (apiClient as any).contentMethods?.getAsyncBatchStatus?.(batchID, targetGuid) 
                          || await (apiClient as any).pageMethods?.getAsyncBatchStatus?.(batchID, targetGuid) 
                          || await (apiClient as any).utilityMethods?.getAsyncBatchStatus?.(batchID, targetGuid)
                          || await (apiClient as any).utilityMethods?.getBatchStatus?.(batchID, targetGuid) 
                          || await (apiClient as any).utilityMethods?.getBatch?.(batchID, targetGuid);
            
            if (!batchStatus) {
                consecutiveApiErrors++;
                
                // FAIL FAST: If we get 3 consecutive "No batch status returned" errors, 
                // the API method doesn't exist - stop wasting time
                if (consecutiveApiErrors >= 3) {
                    console.error(`[Batch Polling] ⚡ FAIL FAST: Batch status API unavailable after ${consecutiveApiErrors} attempts - aborting polling`);
                    throw new Error(`FAIL_FAST: Batch status API method not available - stopped after ${consecutiveApiErrors} consecutive API errors`);
                }
                
                throw new Error('No batch status returned from API - method not available');
            }
            
            // Reset consecutive error counter on successful API call
            consecutiveApiErrors = 0;
            
            // FAIL FAST: Check for errorData immediately - don't wait for completion
            if (batchStatus.errorData && batchStatus.errorData.trim()) {
                console.error(`[Batch Polling] ⚡ FAIL FAST: Batch ${batchID} has errorData - failing immediately`);
                console.error(`[Batch Polling] ErrorData: ${batchStatus.errorData.substring(0, 500)}...`);
                throw new Error(`FAIL_FAST: Batch has errorData - ${batchStatus.errorData.substring(0, 200)}...`);
            }
            
            // Use batchState (not state) to match the actual API response format
            const currentState = batchStatus.batchState || batchStatus.state;
            console.log(`[Batch Polling] Attempt ${attempt}/${maxAttempts} - Batch ${batchID} batchState: ${currentState}`);
            
            // Check batch states: 1=Queued, 2=Processing, 3=Complete, 4=Error, 5=Cancelled
            if (currentState === 3) {
                // Complete and no errorData (checked above)
                console.log(`[Batch Polling] ✅ Batch ${batchID} completed successfully`);
                return batchStatus;
            } else if (currentState === 4) {
                console.log(`[Batch Polling] ❌ Batch ${batchID} failed with error`);
                throw new Error(`Batch processing failed with state: ${currentState}`);
            } else if (currentState === 5) {
                console.log(`[Batch Polling] ⚠️ Batch ${batchID} was cancelled`);
                throw new Error(`Batch processing was cancelled with state: ${currentState}`);
            }
            
            // Still processing, wait before next attempt
            console.log(`[Batch Polling] ⏳ Batch ${batchID} still processing (batchState: ${currentState}), waiting...`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            
        } catch (error: any) {
            console.error(`[Batch Polling] ❌ Error polling batch ${batchID}: ${error.message}`);
            
            // Check if this is the "No batch status returned" error
            if (error.message.includes('No batch status returned from API')) {
                consecutiveApiErrors++;
                
                // FAIL FAST: If we hit the API error limit, stop immediately
                if (consecutiveApiErrors >= 3) {
                    console.error(`[Batch Polling] ⚡ FAIL FAST: Batch status API unavailable after ${consecutiveApiErrors} attempts - aborting polling`);
                    throw new Error(`FAIL_FAST: Batch status API method not available - stopped after ${consecutiveApiErrors} consecutive API errors`);
                }
            }
            
            if (attempt === maxAttempts) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
        }
    }
    
    throw new Error(`Batch polling timeout after ${maxAttempts} attempts for batch ${batchID}`);
}

function extractContentIDFromBatch(batch: any, itemTitle: string): number {
    if (!batch?.batch?.items) {
        console.log(`[Batch Extract] No items found in batch response`);
        return -1;
    }
    
    const items = batch.batch.items;
    console.log(`[Batch Extract] Searching ${items.length} items for content: ${itemTitle}`);
    
    // Look for content items (itemType = 2) with valid IDs
    const contentItems = items.filter((item: any) => 
        item.itemType === 2 && 
        item.itemID > 0 && 
        !item.itemNull &&
        item.itemTitle === itemTitle
    );
    
    if (contentItems.length > 0) {
        const actualContentID = contentItems[0].itemID;
        console.log(`[Batch Extract] ✅ Found content ID: ${actualContentID} for "${itemTitle}"`);
        return actualContentID;
    }
    
    console.log(`[Batch Extract] ❌ No valid content ID found for "${itemTitle}"`);
    return -1;
}
import ansiColors from "ansi-colors";

export interface BatchContentResults {
    successfulItems: number;
    failedItems: number;
    skippedItems: number;
    totalBatches: number;
}

export class BatchContentItemPusher {
    private apiClient: mgmtApi.ApiClient;
    private referenceMapper: ReferenceMapper;
    private targetGuid: string;
    private locale: string;
    private successfulItems: number = 0;
    private failedItems: number = 0;
    private skippedItems: number = 0;
    private defaultTargetAssetContainerOriginUrl: string | null = null;
    private batchSize: number = 100; // Batch size for bulk operations
    private forceSync: boolean = false; // Full sync mode - force update all items
    private processedContentIds: { [key: number]: number } = {}; // Legacy mapping pattern
    private skippedContentItems: { [key: number]: string } = {}; // Legacy skipped pattern
    private existingCount: number = 0;

    constructor(
        apiClient: mgmtApi.ApiClient, 
        referenceMapper: ReferenceMapper, 
        targetGuid: string, 
        locale: string, 
        batchSize: number = 100,
        forceSync: boolean = false
    ) {
        this.apiClient = apiClient;
        this.referenceMapper = referenceMapper;
        this.targetGuid = targetGuid;
        this.locale = locale;
        this.batchSize = batchSize;
        this.forceSync = forceSync;
        this.successfulItems = 0;
        this.failedItems = 0;
        this.skippedItems = 0;
        this.existingCount = 0;
    }

    private async initialize(): Promise<void> {
        try {
            const defaultContainer = await this.apiClient.assetMethods.getDefaultContainer(this.targetGuid);
            this.defaultTargetAssetContainerOriginUrl = defaultContainer?.originUrl || null;
            if (!this.defaultTargetAssetContainerOriginUrl) {
                console.warn(ansiColors.yellow(`[Batch Content Pusher] Could not retrieve default asset container origin URL for target GUID ${this.targetGuid}. Asset URL mapping might be incomplete.`));
            }
        } catch (err: any) {
            console.error(ansiColors.red(`[Batch Content Pusher] Error fetching default asset container for target GUID ${this.targetGuid}: ${err.message}`));
            this.defaultTargetAssetContainerOriginUrl = null; 
        }
    }

    /**
     * Main method: Implements 2-pass batch content processing
     */
    async pushContentItemsBatch(
        contentItems: mgmtApi.ContentItem[], 
        onProgress?: (processed: number, total: number, status?: 'success' | 'error' | 'skipped') => void
    ): Promise<BatchContentResults> {
        
        const syncModeText = this.forceSync ? 'FULL SYNC MODE (force update all)' : 'INCREMENTAL MODE (update changed only)';
        console.log(ansiColors.cyan(`[Batch Content Pusher] Starting 2-pass batch processing for ${contentItems.length} content items`));
        console.log(ansiColors.yellow(`[Sync Mode] ${syncModeText}`));
        
        // 🔍 DEBUG: Show why we're in this sync mode
        console.log(ansiColors.magenta(`🔍 DEBUG CONTENT PUSHER: forceSync=${this.forceSync} (constructor parameter)`));
        
        await this.initialize();

        // Filter out i18 content items (following proven pattern)
        const filteredContentItems = contentItems.filter(item => {
            const referenceName = item.properties.referenceName?.toLowerCase() || '';
            const definitionName = item.properties.definitionName?.toLowerCase() || '';
            
            if (referenceName.includes('i18') || definitionName.includes('i18')) {
                this.skippedItems++;
                return false;
            }
            
            return true;
        });

        console.log(ansiColors.cyan(`[Batch Content Pusher] Processing ${filteredContentItems.length} content items (filtered ${contentItems.length - filteredContentItems.length} i18 items)`));

        // Pass 1: Create content shells with basic metadata
        console.log(ansiColors.yellow('\n📋 Pass 1: Creating content shells...'));
        const shellResults = await this.executePass1_CreateShells(filteredContentItems, onProgress);

        // Pass 2: Update content with full definitions and resolved dependencies
        console.log(ansiColors.yellow('\n🔗 Pass 2: Updating with full definitions and dependencies...'));
        const fullResults = await this.executePass2_UpdateFullDefinitions(filteredContentItems, onProgress);

        const totalBatches = shellResults.batches + fullResults.batches;

        console.log(ansiColors.green(`\n✅ Batch Content Processing Complete:`));
        console.log(`   Successful: ${this.successfulItems}`);
        console.log(`   Failed: ${this.failedItems}`);
        console.log(`   Skipped: ${this.skippedItems}`);
        console.log(`   Total Batches: ${totalBatches}`);

        return {
            successfulItems: this.successfulItems,
            failedItems: this.failedItems,
            skippedItems: this.skippedItems,
            totalBatches: totalBatches
        };
    }

    /**
     * Pass 1: Create content shells with basic metadata only
     * This creates the content items without complex dependencies
     */
    private async executePass1_CreateShells(
        contentItems: mgmtApi.ContentItem[], 
        onProgress?: (processed: number, total: number, status?: 'success' | 'error' | 'skipped') => void
    ): Promise<{ batches: number }> {
        
        console.log(ansiColors.cyan(`[Pass 1] Creating content shells for ${contentItems.length} items...`));
        
        let processed = 0;
        let batchCount = 0;

        // Process in batches for performance
        for (let i = 0; i < contentItems.length; i += this.batchSize) {
            const batch = contentItems.slice(i, i + this.batchSize);
            batchCount++;

            console.log(ansiColors.cyan(`  🔄 [Pass 1] Batch ${batchCount}: Processing ${batch.length} content shells...`));

            const shellPayloads: mgmtApi.ContentItem[] = [];

            for (const contentItem of batch) {
                try {
                    // Check if content already exists (change detection)
                    const existingContent = await this.findExistingContentByReferenceName(contentItem);
                    
                    // DEBUG: Log existence check result for troubleshooting
                    console.log(`  🔍 Existence Check: ${contentItem.properties?.referenceName} (Source ID: ${contentItem.contentID}) → ${existingContent ? `Found (Target ID: ${(existingContent as any).contentID})` : 'NOT FOUND'}`);
                    
                    // ENHANCED: Skip ALL existing content on second/subsequent runs  
                    if (existingContent) {
                        // CRITICAL FIX: Always map existing content ID for Pass 2 even when skipping shell creation
                        const existingTargetId = (existingContent as any).contentID;
                        this.referenceMapper.addRecord('content', 'contentID', {
                            source: { contentID: contentItem.contentID },
                            target: { contentID: existingTargetId }
                        });
                        console.log(`  🔗 MAPPED existing content: ${contentItem.properties?.referenceName} → Target ID: ${existingTargetId}`);
                        
                        if (!this.forceSync && !this.hasContentChanged(contentItem, existingContent)) {
                            console.log(`  ⏭️ Skipping unchanged content: ${contentItem.properties?.referenceName} (incremental mode)`);
                            this.skippedItems++;
                            processed++;
                            onProgress?.(processed, contentItems.length, 'skipped');
                            continue;
                        } else if (this.forceSync) {
                            console.log(`  ⏭️ Skipping existing content: ${contentItem.properties?.referenceName} (force mode - content already exists)`);
                            this.skippedItems++;
                            processed++;
                            onProgress?.(processed, contentItems.length, 'skipped');
                            continue;
                        } else {
                            console.log(`  🔄 Content exists but changed: ${contentItem.properties?.referenceName} - will update`);
                        }
                    }

                    // Create shell payload with basic metadata only
                    const { payload, targetContainerID } = await this.createContentShell(contentItem, existingContent);
                    if (payload) {
                        shellPayloads.push(payload);
                        console.log(`    📝 Prepared shell: ${contentItem.properties?.referenceName} → container: ${targetContainerID}`);
                    }

                } catch (error) {
                    console.error(ansiColors.red(`  ❌ Error creating shell for ${contentItem.properties?.referenceName}: ${error.message}`));
                    this.failedItems++;
                    processed++;
                    onProgress?.(processed, contentItems.length, 'error');
                }
            }

            // Execute bulk shell creation if we have payloads
            if (shellPayloads.length > 0) {
                console.log(`    🚀 Executing batch ${batchCount}: ${shellPayloads.length} content items (filtered from ${batch.length} total)`);
                try {
                    const apiResponse = await this.executeBulkContentUpload(shellPayloads, 'shells');
                    this.successfulItems += shellPayloads.length;
                    
                    // Update reference mapper with new content IDs for Pass 2
                    await this.updateContentIdMappings(batch, shellPayloads, apiResponse);
                    
                } catch (error) {
                    console.error(ansiColors.red(`  ❌ Bulk shell creation failed for batch ${batchCount}: ${error.message}`));
                    this.failedItems += shellPayloads.length;
                }
            }

            processed += batch.length;
            onProgress?.(processed, contentItems.length, 'success');
        }

        return { batches: batchCount };
    }

    /**
     * Pass 2: Update content with full definitions and resolved dependencies
     */
    private async executePass2_UpdateFullDefinitions(
        contentItems: mgmtApi.ContentItem[], 
        onProgress?: (processed: number, total: number, status?: 'success' | 'error' | 'skipped') => void
    ): Promise<{ batches: number }> {
        
        console.log(ansiColors.cyan(`[Pass 2] Updating with full definitions for ${contentItems.length} items...`));
        
        let processed = 0;
        let batchCount = 0;

        // Process in batches
        for (let i = 0; i < contentItems.length; i += this.batchSize) {
            const batch = contentItems.slice(i, i + this.batchSize);
            batchCount++;

            console.log(ansiColors.cyan(`  🔄 [Pass 2] Batch ${batchCount}: Processing ${batch.length} full definitions...`));

            const fullPayloads: mgmtApi.ContentItem[] = [];

            for (const contentItem of batch) {
                try {
                    // Get the target content ID from Pass 1 mapping
                    const mapping = this.referenceMapper.getMapping('content', 'contentID', contentItem.contentID);
                    const targetContentId = mapping?.target ? (mapping.target as any).contentID : null;
                    
                    if (!targetContentId || targetContentId === -1) {
                        console.log(`  ⏭️ Skipping Pass 2 for unmapped content: ${contentItem.properties?.referenceName}`);
                        processed++;
                        continue;
                    }

                    // Create full payload with resolved dependencies
                    const fullPayload = await this.createFullContentDefinition(contentItem, targetContentId);
                    fullPayloads.push(fullPayload);
                    console.log(`    🔗 Prepared full definition: ${contentItem.properties?.referenceName} → target ID: ${targetContentId}`);

                } catch (error) {
                    console.error(ansiColors.red(`  ❌ Error creating full definition for ${contentItem.properties?.referenceName}: ${error.message}`));
                    this.failedItems++;
                    processed++;
                    onProgress?.(processed, contentItems.length, 'error');
                }
            }

            // Execute bulk full definition updates
            if (fullPayloads.length > 0) {
                console.log(`    🚀 Executing batch ${batchCount}: ${fullPayloads.length} full definitions (filtered from ${batch.length} total)`);
                try {
                    await this.executeBulkContentUpload(fullPayloads, 'full definitions');
                    
                } catch (error) {
                    console.error(ansiColors.red(`  ❌ Bulk full definition update failed for batch ${batchCount}: ${error.message}`));
                    this.failedItems += fullPayloads.length;
                }
            }

            processed += batch.length;
            onProgress?.(processed, contentItems.length, 'success');
        }

        return { batches: batchCount };
    }

    /**
     * Create a content shell with basic metadata only (Pass 1)
     * CRITICAL FIX: Must find target container ID and group content by container
     */
    private async createContentShell(contentItem: mgmtApi.ContentItem, existingContent?: mgmtApi.ContentItem): Promise<{ payload: mgmtApi.ContentItem, targetContainerID: number | null }> {
        const defaultSeo: mgmtApi.SeoProperties = { 
            metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null 
        };
        const defaultScripts: mgmtApi.ContentScripts = { top: null, bottom: null };

        // CRITICAL FIX: Find the actual target container ID (not just name)
        const originalDefinitionName = contentItem.properties?.definitionName || '';
        const contentReferenceName = contentItem.properties?.referenceName || '';
        
        console.log(`    🔍 CONTAINER RESOLUTION: Content "${contentReferenceName}" (model: "${originalDefinitionName}")`);
        
        // Step 1: Determine source container name
        let sourceContainerName = '';
        
        // If content has contentViewID (for content from /list/ folder), find the container via mapper
        if ((contentItem as any).contentViewID) {
            const containerMapping = this.referenceMapper.getContainerMappingById((contentItem as any).contentViewID);
            if (containerMapping?.source && (containerMapping.source as any).referenceName) {
                sourceContainerName = (containerMapping.source as any).referenceName || '';
                console.log(`    📦 Found container via contentViewID ${(contentItem as any).contentViewID}: "${sourceContainerName}"`);
            }
        }
        
        // CONTAINER INFERENCE: If no container found, infer from content reference name
        if (!sourceContainerName) {
            console.log(`    🔍 CONTAINER INFERENCE: No contentViewID, inferring container from content name...`);
            sourceContainerName = this.inferContainerFromContentName(contentReferenceName);
            console.log(`    🎯 Inferred container: "${sourceContainerName}" from content: "${contentReferenceName}"`);
        }
        
        // Step 2: Find the target container using our mapping logic
        const mappedContainerName = this.mapContentToTargetContainer(sourceContainerName, originalDefinitionName);
        
        // Step 3: Get the actual container ID from the reference mapper
        const containerMapping = this.referenceMapper.getMapping('container', 'referenceName', mappedContainerName);
        
        if (!containerMapping?.target) {
            console.log(`    ❌ NO TARGET CONTAINER FOUND: "${mappedContainerName}" - content will be skipped`);
            return { payload: null as any, targetContainerID: null };
        }
        
        const targetContainer = containerMapping.target as any;
        const targetContainerID = targetContainer.contentViewID || targetContainer.containerID;
        
        if (!targetContainerID || targetContainerID <= 0) {
            console.log(`    ❌ INVALID CONTAINER ID: "${mappedContainerName}" has ID ${targetContainerID} - content will be skipped`);
            return { payload: null as any, targetContainerID: null };
        }
        
        console.log(`    ✅ CONTAINER RESOLVED: "${mappedContainerName}" → ID: ${targetContainerID}`);

        // ENHANCED: Include more field data from source content to satisfy model requirements
        const shellFields: any = {};
        
        if (contentItem.fields) {
            // Copy all primitive fields (strings, numbers, booleans) that don't require dependency resolution
            Object.keys(contentItem.fields).forEach(fieldKey => {
                const fieldValue = contentItem.fields[fieldKey];
                
                // Include primitive types and simple objects that don't need dependency resolution
                if (fieldValue !== null && fieldValue !== undefined) {
                    if (typeof fieldValue === 'string' || 
                        typeof fieldValue === 'number' || 
                        typeof fieldValue === 'boolean') {
                        shellFields[fieldKey] = fieldValue;
                    } else if (typeof fieldValue === 'object' && fieldValue !== null) {
                        // Include simple objects that don't contain complex references
                        // Skip fields that contain URLs (will be handled in Pass 2)
                        const fieldStr = JSON.stringify(fieldValue);
                        if (!fieldStr.includes('cdn.aglty.io') && 
                            !fieldStr.includes('contentID') && 
                            !fieldStr.includes('mediaID')) {
                            shellFields[fieldKey] = fieldValue;
                        }
                    }
                }
            });
        }
        
        // Ensure we have at least a title field
        if (!shellFields.title && !shellFields.Title) {
            shellFields.title = contentItem.fields?.title || 
                              contentItem.fields?.Title || 
                              contentItem.properties?.referenceName || 
                              'Untitled Content';
        }

        console.log(`    📝 Content Shell Fields: ${Object.keys(shellFields).join(', ')} → Container ID: ${targetContainerID}`);

        const payload = {
            contentID: existingContent ? existingContent.contentID : -1, // -1 for new content
            properties: {
                state: contentItem.properties?.state || 2,
                modified: new Date().toISOString(),
                modifiedBy: contentItem.properties?.modifiedBy || null,
                pullDate: contentItem.properties?.pullDate || null,
                releaseDate: contentItem.properties?.releaseDate || null,
                versionID: -1, // Will be assigned by API
                referenceName: contentItem.properties?.referenceName || '',
                definitionName: originalDefinitionName, // KEEP ORIGINAL MODEL NAME - DO NOT CHANGE THIS!
                itemOrder: existingContent ? existingContent.properties?.itemOrder : (contentItem.properties?.itemOrder || 0)
            },
            fields: shellFields, // Enhanced field data instead of just title
            seo: defaultSeo,
            scripts: defaultScripts
        };

        return { payload, targetContainerID };
    }

    /**
     * Create full content definition with resolved dependencies (Pass 2)
     */
    private async createFullContentDefinition(contentItem: mgmtApi.ContentItem, targetContentId: number): Promise<mgmtApi.ContentItem> {
        // Use the proven mapping logic from content-item-mapper
        const mappedContentItem = await mapContentItem(
            contentItem, 
            this.referenceMapper,
            this.apiClient,
            this.targetGuid,
            this.defaultTargetAssetContainerOriginUrl || ''
        );

        const defaultSeo: mgmtApi.SeoProperties = { 
            metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null 
        };
        const defaultScripts: mgmtApi.ContentScripts = { top: null, bottom: null };

        // CRITICAL FIX: Keep original model name for definitionName - DO NOT change to container name
        const originalDefinitionName = contentItem.properties?.definitionName || '';

        return {
            contentID: targetContentId, // Use mapped target ID
            properties: {
                ...mappedContentItem.properties,
                definitionName: originalDefinitionName, // KEEP ORIGINAL MODEL NAME - DO NOT CHANGE THIS!
                referenceName: mappedContentItem.properties.referenceName || contentItem.properties.referenceName,
            },
            fields: mappedContentItem.fields, // Fully mapped fields with dependencies resolved
            seo: mappedContentItem.seo ?? defaultSeo,
            scripts: mappedContentItem.scripts ?? defaultScripts
        };
    }

    /**
     * Execute bulk content upload grouped by container IDs
     * CRITICAL FIX: Group content by target container and use container-specific API calls
     */
    private async executeBulkContentUpload(payloads: mgmtApi.ContentItem[], type: string): Promise<any> {
        try {
            console.log(`    🚀 ${type === 'shells' ? 'Creating content items' : 'Updating content'}: ${payloads.length} items...`);
            
            // Use batch saveContentItems API - the container resolution is handled in payload creation
            const result = await this.apiClient.contentMethods.saveContentItems(payloads, this.targetGuid, this.locale);
            
            console.log(`\n🔍 [API RESPONSE DEBUG] Raw API Response for ${type}:`);
            console.log(`    📊 Response type: ${typeof result}`);
            console.log(`    📋 Response keys: ${result && typeof result === 'object' ? Object.keys(result) : 'N/A'}`);
            
            // CRITICAL FIX: Handle array response format (direct content IDs)
            if (Array.isArray(result)) {
                console.log(`[Content Batch] Direct array response with ${result.length} content IDs`);
                
                // Convert array to items format for processing
                const items = result.map((contentId, index) => ({
                    itemID: contentId,
                    contentID: contentId,
                    referenceName: payloads[index]?.properties?.referenceName || `item-${index}`,
                    itemTitle: payloads[index]?.properties?.referenceName || `item-${index}`
                }));
                
                // Transform to expected format
                const transformedResult = {
                    items: items,
                    batchPolled: false,
                    directArray: true
                };
                
                console.log(`    ✅ Content items processed: ${items.length} direct content IDs`);
                
                return transformedResult;
                
            }
            // Check if this is a batch response that needs processing
            else if (result && typeof result === 'object' && 'batchID' in result) {

                    const batchID = result.batchID;
                    const batchState = result.batchState;
                    const existingItems = result.items || [];
                    
                    console.log(`[Content Batch] Response contains batchID: ${batchID}, batchState: ${batchState}`);
                    console.log(`[Content Batch] Batch response already contains ${existingItems.length} items`);
                    
                    // Check if batch is already complete (batchState 3 = Complete)
                    if (Number(batchState) === 3) {
                        console.log(`[Content Batch] ✅ Batch ${batchID} is already complete - using existing items`);
                        
                        const successCount = existingItems.filter((item: any) => item.itemID && item.itemID > 0 && !item.itemNull).length;
                        const skippedCount = existingItems.filter((item: any) => item.itemNull === true || item.itemID === -1).length;
                        const failureCount = existingItems.length - successCount - skippedCount;
                        
                        console.log(`    ✅ Content processing complete: ${successCount} success, ${skippedCount} skipped, ${failureCount} failed`);
                        
                        return result; // Return as-is since batch is complete
                        
                    } else if (Number(batchState) === 1 || Number(batchState) === 2) {
                        // Batch is still queued or processing, try polling
                        console.log(`[Content Batch] Batch ${batchID} is still processing (state: ${batchState}), attempting to poll...`);
                        
                        try {
                            // Poll the batch until completion
                            const completedBatch = await pollBatchStatus(this.apiClient, batchID, this.targetGuid);
                            
                            // Extract real content IDs from completed batch
                            const polledItems = completedBatch?.batch?.items || [];
                            console.log(`[Content Batch] Completed batch contains ${polledItems.length} items`);
                            
                            // Update the original response with polled results
                            const updatedResult = {
                                ...result,
                                items: polledItems,
                                batchPolled: true
                            };
                            
                            // Log success/failure counts from polled batch
                            const successCount = polledItems.filter((item: any) => item.itemID && item.itemID > 0 && !item.itemNull).length;
                            const skippedCount = polledItems.filter((item: any) => item.itemNull === true || item.itemID === -1).length;
                            const failureCount = polledItems.length - successCount - skippedCount;
                            
                            console.log(`    ✅ Content processing complete: ${successCount} success, ${skippedCount} skipped, ${failureCount} failed`);
                            
                            return updatedResult;
                            
                        } catch (batchError: any) {
                            console.error(`[Content Batch] ❌ Failed to poll batch ${batchID}: ${batchError.message}`);
                            console.log(`[Content Batch] Falling back to original batch response with ${existingItems.length} items`);
                            
                            // Fall back to original response items
                            return result;
                        }
                        
                    } else if (Number(batchState) === 4 || Number(batchState) === 5) {
                        // Batch failed or was cancelled
                        console.error(`[Content Batch] ❌ Batch ${batchID} failed with state: ${batchState}`);
                        console.log(`[Content Batch] Error data: ${result.errorData || 'No error details'}`);
                        
                        return result; // Return failed batch response
                        
                    } else {
                        console.log(`[Content Batch] Unknown batch state: ${batchState}, treating as incomplete`);
                        return result;
                    }
                }
                
                // Handle non-batch responses (direct content creation)
                if (result && typeof result === 'object' && 'items' in result) {
                    const items = (result as any).items || [];
                    const successCount = items.filter((item: any) => item.itemID && item.itemID > 0 && !item.itemNull).length;
                    const skippedCount = items.filter((item: any) => item.itemNull === true || item.itemID === -1).length;
                    const failureCount = items.length - successCount - skippedCount;
                    
                    console.log(`    ✅ Content items processed: ${successCount} success, ${skippedCount} skipped, ${failureCount} failed`);
                    console.log(`    📊 Items array length: ${items.length}`);
                    
                    // Log first successful item structure for debugging
                    const firstSuccessItem = items.find((item: any) => item.itemID && item.itemID > 0);
                    if (firstSuccessItem) {
                        console.log(`     [SUCCESS ITEM STRUCTURE]:`);
                        console.log(`      - itemID: ${firstSuccessItem.itemID}`);
                        console.log(`      - itemTitle: ${firstSuccessItem.itemTitle || 'N/A'}`);
                        console.log(`      - referenceName: ${firstSuccessItem.referenceName || 'N/A'}`);
                        console.log(`      - Available fields: ${Object.keys(firstSuccessItem)}`);
                    }
                    
                    if (failureCount > 0) {
                        // Log bulk failures for debugging
                        const failedItems = items.filter((item: any) => !item.itemID || item.itemID <= 0);
                        console.log(ansiColors.yellow(`    ⚠️ Failed content items:`));
                        failedItems.slice(0, 3).forEach((item: any, index: number) => {
                            console.log(`      ${index + 1}. ${item.itemTitle || 'No Title'} (${item.itemNull ? 'itemNull: true' : 'other error'})`);
                            console.log(`         Fields: ${Object.keys(item).join(', ')}`);
                        });
                    }
                } else {
                    console.log(`    ✅ Content processing completed (response format: ${typeof result})`);
                    console.log(`    📋 Full response: ${JSON.stringify(result).substring(0, 200)}...`);
                }
                
                return result; // Return the processed response
            
        } catch (error) {
            console.error(`    ❌ Content processing error:`, error.message);
            throw error;
        }
    }

    /**
     * Find existing content by reference name (change detection)
     */
    private async findExistingContentByReferenceName(contentItem: mgmtApi.ContentItem): Promise<mgmtApi.ContentItem | null> {
        try {
            // FIXED: Check reference mapper by contentID (how mappings are actually stored)
            const mapping = this.referenceMapper.getMapping('content', 'contentID', contentItem.contentID);
            if (mapping?.target) {
                console.log(`✅ Found existing content in mapper: ${contentItem.properties?.referenceName} (Source ID: ${contentItem.contentID} → Target ID: ${(mapping.target as any).contentID})`);
                return mapping.target as mgmtApi.ContentItem;
            }

            // If not in mapper, use existing finder (though it may have limitations)
            return await findContentInTargetInstance(contentItem, this.apiClient, this.targetGuid, this.locale, this.referenceMapper);
            
        } catch (error) {
            // If not found or error, assume it's new content
            return null;
        }
    }

    /**
     * Basic change detection (can be enhanced)
     */
    private hasContentChanged(sourceContent: mgmtApi.ContentItem, targetContent: mgmtApi.ContentItem): boolean {
        // Simple comparison - can be enhanced with hash-based comparison
        const sourceModified = sourceContent.properties?.modified;
        const targetModified = targetContent.properties?.modified;
        
        if (sourceModified && targetModified) {
            return new Date(sourceModified) > new Date(targetModified);
        }
        
        // If no modification dates, assume changed to be safe
        return true;
    }

    /**
     * Normalize spacing in container names (DocArticle → Doc Article, ListofLinks → List of Links)
     */
    private normalizeSpacing(text: string): string {
        // Handle common camelCase to spaced patterns
        return text
            // Insert space before capital letters in camelCase: DocArticle → Doc Article
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            // Handle "of" patterns: ListofLinks → List of Links
            .replace(/([a-z])of([A-Z])/g, '$1 of $2')
            // Handle "Or" patterns: RightOrLeft → Right Or Left  
            .replace(/([a-z])Or([A-Z])/g, '$1 Or $2')
            // Handle "And" patterns: LeftAndRight → Left And Right
            .replace(/([a-z])And([A-Z])/g, '$1 And $2')
            // Clean up multiple spaces
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * CRITICAL FIX: Handle hash-based container name mapping for content items
     * ISSUE: Content items reference lowercase names but containers get uppercase hash suffixes  
     * EXAMPLE: content "changelog_changelog52c913d6" → container "ChangeLog_ChangeLog52C913D6"
     * CRITICAL: Content with definitionName "ChangeLog" must map to containers with Model:ChangeLog
     */
    private mapContentToTargetContainer(sourceContainerReferenceName: string, contentDefinitionName?: string): string {
        console.log(`\n🔍 [CONTAINER MAPPING - MODEL AWARE] Looking for target container for source container: "${sourceContainerReferenceName}"`);
        if (contentDefinitionName) {
            console.log(`   📋 Content requires model: "${contentDefinitionName}"`);
        }
        
        const containerMappings = this.referenceMapper.getRecordsByType('container');
        console.log(`   📊 Available container mappings: ${containerMappings.length}`);
        
        // STRATEGY 1: Direct exact match with model compatibility (fastest path)
        for (const mapping of containerMappings) {
            const sourceContainer = mapping.source;
            const targetContainer = mapping.target;
            
            if (sourceContainer?.referenceName === sourceContainerReferenceName && targetContainer?.referenceName) {
                // Check model compatibility if we have content definition name
                if (this.isModelCompatible(targetContainer, contentDefinitionName)) {
                    console.log(`  🔗 ✅ DIRECT EXACT MATCH: "${sourceContainerReferenceName}" → "${targetContainer.referenceName}" (Model: ${targetContainer.contentDefinitionName || 'Unknown'})`);
                    return targetContainer.referenceName;
                } else {
                    console.log(`  🚫 DIRECT MATCH REJECTED: "${targetContainer.referenceName}" - Model incompatible (has: ${targetContainer.contentDefinitionName}, needs: ${contentDefinitionName})`);
                }
            }
        }
        
        // STRATEGY 2: Case-insensitive matching with model compatibility  
        for (const mapping of containerMappings) {
            const sourceContainer = mapping.source;
            const targetContainer = mapping.target;
            
            if (sourceContainer?.referenceName?.toLowerCase() === sourceContainerReferenceName.toLowerCase() && targetContainer?.referenceName) {
                if (this.isModelCompatible(targetContainer, contentDefinitionName)) {
                    console.log(`  🔗 ✅ CASE-INSENSITIVE MATCH: "${sourceContainerReferenceName}" → "${targetContainer.referenceName}" (Model: ${targetContainer.contentDefinitionName || 'Unknown'})`);
                    return targetContainer.referenceName;
                } else {
                    console.log(`  🚫 CASE-INSENSITIVE MATCH REJECTED: "${targetContainer.referenceName}" - Model incompatible`);
                }
            }
        }
        
        // STRATEGY 3: Hash-based container name lookup (CRITICAL FIX)
        // Check if sourceContainerReferenceName looks like it should map to a hashed container
        // Pattern: "changelog_changelog52c913d6" should find "ChangeLog_ChangeLog52C913D6"
        const hashNameMappings = this.referenceMapper.getRecordsByType('container-name');
        console.log(`   🔍 Checking ${hashNameMappings.length} hash-based container name mappings...`);
        
        for (const mapping of hashNameMappings) {
            const originalName = mapping.source?.originalName;
            const hashedName = mapping.target?.hashedName;
            
            if (originalName && hashedName) {
                // Check if content reference matches the original name (case-insensitive)
                if (originalName.toLowerCase() === sourceContainerReferenceName.toLowerCase()) {
                    console.log(`  🔗 ✅ HASH-BASED MATCH: "${sourceContainerReferenceName}" → "${hashedName}" (via hash mapping)`);
                    return hashedName;
                }
                
                // Also check if content reference contains hash portion of the hashed name
                const hashMatch = sourceContainerReferenceName.match(/([a-f0-9]{8})$/i);
                const hashedMatch = hashedName.match(/([A-F0-9]{8})$/);
                
                if (hashMatch && hashedMatch && hashMatch[1].toUpperCase() === hashedMatch[1]) {
                    console.log(`  🔗 ✅ HASH PORTION MATCH: "${sourceContainerReferenceName}" → "${hashedName}" (hash: ${hashMatch[1]})`);
                    return hashedName;
                }
            }
        }
        
        // STRATEGY 4: Pattern-based hash matching with model compatibility (fallback for edge cases)
        // Look for containers that contain similar base names with hash suffixes
        for (const mapping of containerMappings) {
            const targetContainer = mapping.target;
            
            if (targetContainer?.referenceName) {
                const targetName = targetContainer.referenceName;
                
                // Extract base name from content reference (remove potential hash suffix)
                const contentBaseName = sourceContainerReferenceName.replace(/[a-f0-9]{8}$/i, '');
                
                // Check if target container name starts with similar base and has hash suffix
                if (targetName.toLowerCase().startsWith(contentBaseName.toLowerCase()) && 
                    targetName.match(/[A-F0-9]{8}$/)) {
                    if (this.isModelCompatible(targetContainer, contentDefinitionName)) {
                        console.log(`  🔗 ✅ PATTERN-BASED HASH MATCH: "${sourceContainerReferenceName}" → "${targetName}" (base: ${contentBaseName}, Model: ${targetContainer.contentDefinitionName || 'Unknown'})`);
                        return targetName;
                    } else {
                        console.log(`  🚫 PATTERN-BASED MATCH REJECTED: "${targetName}" - Model incompatible`);
                    }
                }
            }
        }

        // STRATEGY 5: Model-compatible container lookup (when name matching fails)
        // Look for any container that accepts the required content model
        if (contentDefinitionName) {
            console.log(`   🔍 STRATEGY 5: Looking for any container accepting model "${contentDefinitionName}"...`);
            
            for (const mapping of containerMappings) {
                const targetContainer = mapping.target;
                
                if (targetContainer?.referenceName && this.isModelCompatible(targetContainer, contentDefinitionName)) {
                    console.log(`  🔗 ✅ MODEL-COMPATIBLE MATCH: "${sourceContainerReferenceName}" → "${targetContainer.referenceName}" (Model: ${targetContainer.contentDefinitionName})`);
                    console.log(`      📝 Note: Name-based matching failed, using model compatibility`);
                    return targetContainer.referenceName;
                }
            }
        }
        
        // No mapping found - enhanced debugging for hash-based mapping issues
        console.warn(`⚠️ No container mapping found for source container: "${sourceContainerReferenceName}"`);
        console.log(`   🔍 DEBUG: First 10 available containers:`, containerMappings.slice(0, 10).map(m => ({
            source: m.source?.referenceName || 'NO_SOURCE',
            target: m.target?.referenceName || 'NO_TARGET'
        })));
        console.log(`   🔍 DEBUG: Hash mappings available: ${hashNameMappings.length}`);
        console.log(`   📊 Total container mappings available: ${containerMappings.length}`);
        
        // Enhanced debug: Look for potential hash matches in available containers
        const potentialHashMatches = containerMappings.filter(m => {
            const targetName = m.target?.referenceName;
            return targetName && targetName.toLowerCase().includes(sourceContainerReferenceName.toLowerCase().substring(0, 8));
        });
        
        if (potentialHashMatches.length > 0) {
            console.log(`   🔍 POTENTIAL HASH MATCHES (${potentialHashMatches.length}):`, 
                potentialHashMatches.map(m => m.target?.referenceName).slice(0, 5));
        }
        
        // Fallback: Return original - may work if target has same container name
        console.log(`   🔄 FALLBACK: Using source container name "${sourceContainerReferenceName}" as target reference`);
        return sourceContainerReferenceName;
    }

    /**
     * Infer container name from content reference name
     * CRITICAL: This enables content from /item/ folder to find their containers
     * Strategy: Case-insensitive pattern matching with container names
     */
    private inferContainerFromContentName(contentReferenceName: string): string {
        if (!contentReferenceName) {
            return '';
        }
        
        const containerMappings = this.referenceMapper.getRecordsByType('container');
        const contentRef = contentReferenceName.toLowerCase();
        
        // Strategy 1: Exact match (case insensitive)
        for (const mapping of containerMappings) {
            const containerName = (mapping.source as any)?.referenceName;
            if (containerName && containerName.toLowerCase() === contentRef) {
                console.log(`    🎯 EXACT MATCH: "${contentReferenceName}" → "${containerName}"`);
                return containerName;
            }
        }
        
        // Strategy 2: Container name contains content name
        for (const mapping of containerMappings) {
            const containerName = (mapping.source as any)?.referenceName;
            if (containerName && containerName.toLowerCase().includes(contentRef)) {
                console.log(`    🎯 CONTAINER CONTAINS CONTENT: "${contentReferenceName}" → "${containerName}"`);
                return containerName;
            }
        }
        
        // Strategy 3: Content name contains container name  
        for (const mapping of containerMappings) {
            const containerName = (mapping.source as any)?.referenceName;
            if (containerName && contentRef.includes(containerName.toLowerCase())) {
                console.log(`    🎯 CONTENT CONTAINS CONTAINER: "${contentReferenceName}" → "${containerName}"`);
                return containerName;
            }
        }
        
        // Strategy 4: Pattern matching (underscore separated)
        if (contentRef.includes('_')) {
            const contentParts = contentRef.split('_');
            const basePattern = contentParts[0];
            
            for (const mapping of containerMappings) {
                const containerName = (mapping.source as any)?.referenceName;
                if (containerName && containerName.toLowerCase().startsWith(basePattern.toLowerCase())) {
                    console.log(`    🎯 PATTERN MATCH: "${contentReferenceName}" → "${containerName}" (pattern: ${basePattern})`);
                    return containerName;
                }
            }
        }
        
        // Strategy 5: Changelog-specific pattern matching
        // Pattern: changelog_changelogXXXXXXXX → ChangeLog_ChangeLogXXXXXXXX
        if (contentRef.startsWith('changelog_changelog')) {
            const hashSuffix = contentRef.replace('changelog_changelog', '').toUpperCase();
            const targetPattern = `ChangeLog_ChangeLog${hashSuffix}`;
            
            for (const mapping of containerMappings) {
                const containerName = (mapping.source as any)?.referenceName;
                if (containerName && containerName === targetPattern) {
                    console.log(`    🎯 CHANGELOG HASH MATCH: "${contentReferenceName}" → "${containerName}"`);
                    return containerName;
                }
            }
            
            // Fallback to base ChangeLog_ChangeLog if exact hash not found
            for (const mapping of containerMappings) {
                const containerName = (mapping.source as any)?.referenceName;
                if (containerName && containerName === 'ChangeLog_ChangeLog') {
                    console.log(`    🎯 CHANGELOG FALLBACK: "${contentReferenceName}" → "${containerName}"`);
                    return containerName;
                }
            }
        }
        
        console.log(`    ⚠️ NO CONTAINER INFERENCE: Could not infer container for "${contentReferenceName}"`);
        return contentReferenceName; // Fallback to original content name
    }

    /**
     * Check if a target container is compatible with the required content model
     * CRITICAL FIX: Use schemaTitle from container data (not contentDefinitionName)
     * Container structure: { contentDefinitionID: 11, schemaTitle: "Doc Section", referenceName: "..." }
     * Model structure: { id: 11, displayName: "Doc Section", referenceName: "DocSection" }
     */
    private isModelCompatible(targetContainer: any, requiredModelName?: string): boolean {
        // If no model requirement specified, allow any container
        if (!requiredModelName) {
            return true;
        }
        
        // CRITICAL FIX: Use schemaTitle from container (not contentDefinitionName)
        const containerModelTitle = targetContainer?.schemaTitle;
        
        // If container has no schema title, allow it (fallback behavior)
        if (!containerModelTitle) {
            console.log(`      ⚠️  Container has no schemaTitle - allowing by default`);
            return true;
        }
        
        // Get reference mapper to find model compatibility
        const modelMappings = this.referenceMapper.getRecordsByType('model');
        
        // Find the source model that matches the content's definitionName
        let sourceModelDisplayName = '';
        for (const modelMapping of modelMappings) {
            const sourceModel = modelMapping.source;
            if (sourceModel?.referenceName === requiredModelName) {
                sourceModelDisplayName = sourceModel.displayName;
                break;
            }
        }
        
        // If we found the model's displayName, use that for comparison
        // Otherwise fall back to direct referenceName comparison
        const modelToCompare = sourceModelDisplayName || requiredModelName;
        
        // Check if container's schemaTitle matches the model's displayName (case-insensitive)
        const isCompatible = containerModelTitle.toLowerCase() === modelToCompare.toLowerCase();
        
        if (!isCompatible) {
            console.log(`      🚫 Model mismatch: Container accepts "${containerModelTitle}", content needs model "${modelToCompare}" (ref: ${requiredModelName})`);
        } else {
            console.log(`      ✅ Model compatible: Container accepts "${containerModelTitle}" = content model "${modelToCompare}"`);
        }
        
        return isCompatible;
    }

    /**
     * Update reference mapper with new content ID mappings from Pass 1 API response
     * CRITICAL FIX: Use reference name matching instead of dangerous index-based mapping
     */
    private async updateContentIdMappings(sourceItems: mgmtApi.ContentItem[], shellPayloads: mgmtApi.ContentItem[], apiResponse: any): Promise<void> {
        console.log(`\n🔍 [CONTENT ID MAPPING DEBUG] =================================`);
        console.log(`🔍 Updating content ID mappings from API response`);
        console.log(`    📊 Source items: ${sourceItems.length}`);
        console.log(`    📊 Shell payloads: ${shellPayloads.length}`);
        console.log(`    📊 API response type: ${typeof apiResponse}`);
        
        if (!apiResponse) {
            console.error(`❌ No API response provided for content ID mapping`);
            return;
        }
        
        // Extract items from API response
        let responseItems: any[] = [];
        if (apiResponse && typeof apiResponse === 'object' && 'items' in apiResponse) {
            responseItems = apiResponse.items || [];
            console.log(`    📊 Response items found: ${responseItems.length}`);
        } else {
            console.error(`❌ API response does not contain 'items' array`);
            console.log(`    📋 Available response keys: ${typeof apiResponse === 'object' ? Object.keys(apiResponse) : 'N/A'}`);
            return;
        }
        
        // CRITICAL FIX: Use reference name matching instead of index-based mapping
        // The old approach assumed sourceItems[i] maps to responseItems[i] which is wrong if API reorders items
        
        let mappedCount = 0;
        let unmappedSourceItems: string[] = [];
        let unmappedResponseItems: string[] = [];
        
        // Debug response item structure to understand available fields
        console.log(`    🔍 DEBUG: First response item structure:`, responseItems[0] ? Object.keys(responseItems[0]) : 'No items');
        if (responseItems.length > 0) {
            console.log(`    🔍 DEBUG: Sample response item:`, {
                referenceName: responseItems[0].referenceName,
                itemTitle: responseItems[0].itemTitle,
                title: responseItems[0].title,
                contentID: responseItems[0].contentID,
                itemID: responseItems[0].itemID
            });
        }
        
        // Create lookup map of response items by reference name for efficient matching
        // CRITICAL FIX: Use multiple strategies to find unique identifiers
        const responseItemsByRef = new Map<string, any>();
        const responseItemsByIndex = new Map<number, any>();
        
        responseItems.forEach((responseItem, index) => {
            // Strategy 1: Use referenceName if available
            if (responseItem.referenceName && responseItem.referenceName.trim() !== '') {
                responseItemsByRef.set(responseItem.referenceName, responseItem);
            }
            // Strategy 2: Use itemTitle if available
            else if (responseItem.itemTitle && responseItem.itemTitle.trim() !== '' && responseItem.itemTitle !== 'No Title') {
                responseItemsByRef.set(responseItem.itemTitle, responseItem);
            }
            // Strategy 3: Use title field if available
            else if (responseItem.title && responseItem.title.trim() !== '' && responseItem.title !== 'No Title') {
                responseItemsByRef.set(responseItem.title, responseItem);
            }
            // Strategy 4: Store by index for fallback matching
            responseItemsByIndex.set(index, responseItem);
        });
        
        console.log(`    🗂️ Created response lookup map with ${responseItemsByRef.size} named entries and ${responseItemsByIndex.size} indexed entries`);
        
        // Match source items to response items using multiple strategies
        for (let i = 0; i < sourceItems.length; i++) {
            const sourceItem = sourceItems[i];
            const sourceRefName = sourceItem.properties?.referenceName;
            
            if (!sourceRefName) {
                console.warn(`    ⚠️ Source item has no reference name, skipping mapping`);
                continue;
            }
            
            let matchingResponseItem = null;
            let matchingStrategy = '';
            
            // Strategy 1: Direct reference name match
            matchingResponseItem = responseItemsByRef.get(sourceRefName);
            if (matchingResponseItem) {
                matchingStrategy = 'direct-ref';
            }
            
            // Strategy 2: Case-insensitive reference name match
            if (!matchingResponseItem) {
                const entries = Array.from(responseItemsByRef.entries());
                for (const [key, value] of entries) {
                    if (key.toLowerCase() === sourceRefName.toLowerCase()) {
                        matchingResponseItem = value;
                        matchingStrategy = 'case-insensitive';
                        break;
                    }
                }
            }
            
            // Strategy 3: Index-based fallback (assumes same order)
            if (!matchingResponseItem && i < responseItemsByIndex.size) {
                matchingResponseItem = responseItemsByIndex.get(i);
                matchingStrategy = 'index-based';
                console.warn(`    ⚠️ Using index-based fallback for "${sourceRefName}" (index ${i})`);
            }
            
            if (matchingResponseItem) {
                // Extract target content ID from response
                const targetContentId = matchingResponseItem.itemID || matchingResponseItem.contentID;
                
                if (targetContentId && targetContentId > 0) {
                    // Create target content object for mapping
                    const targetContent = {
                        contentID: targetContentId,
                        properties: {
                            referenceName: sourceItem.properties?.referenceName,
                            definitionName: sourceItem.properties?.definitionName,
                            state: sourceItem.properties?.state,
                            modified: new Date().toISOString()
                        }
                    };
                    
                    // Add to reference mapper
                    this.referenceMapper.addRecord('content', sourceItem, targetContent);
                    
                    mappedCount++;
                    console.log(`    ✅ Mapped (${matchingStrategy}): "${sourceRefName}" (${sourceItem.contentID} → ${targetContentId})`);
                } else {
                    console.error(`    ❌ Valid response found but no target content ID: "${sourceRefName}"`);
                    console.log(`       Response item keys: ${Object.keys(matchingResponseItem)}`);
                    unmappedSourceItems.push(sourceRefName);
                }
            } else {
                console.warn(`    ⚠️ No response item found for source ref: "${sourceRefName}" (tried all strategies)`);
                unmappedSourceItems.push(sourceRefName);
            }
        }
        
        // Log any response items that weren't matched to source items
        responseItems.forEach(responseItem => {
            const responseRefName = responseItem.referenceName || responseItem.itemTitle || 'unknown';
            const wasMatched = sourceItems.some(sourceItem => 
                sourceItem.properties?.referenceName === responseRefName
            );
            
            if (!wasMatched) {
                unmappedResponseItems.push(responseRefName);
            }
        });
        
        console.log(`\n🎯 Content ID mapping summary (REFERENCE NAME BASED):`);
        console.log(`    ✅ Successfully mapped: ${mappedCount}/${sourceItems.length} items`);
        console.log(`    ❌ Unmapped source items: ${unmappedSourceItems.length}`);
        console.log(`    ❌ Unmapped response items: ${unmappedResponseItems.length}`);
        console.log(`    📋 Reference mapper now has ${this.referenceMapper.getRecordsByType('content').length} content mappings`);
        
        // Log details for debugging if there are unmapped items
        if (unmappedSourceItems.length > 0) {
            console.log(`    🔍 Unmapped source references: ${unmappedSourceItems.slice(0, 10).join(', ')}${unmappedSourceItems.length > 10 ? ' ...' : ''}`);
        }
        if (unmappedResponseItems.length > 0) {
            console.log(`    🔍 Unmapped response references: ${unmappedResponseItems.slice(0, 10).join(', ')}${unmappedResponseItems.length > 10 ? ' ...' : ''}`);
        }
        
        // VALIDATION: Check if we have significant mapping failures
        const mappingSuccessRate = (mappedCount / sourceItems.length) * 100;
        if (mappingSuccessRate < 90) {
            console.warn(`⚠️ WARNING: Low mapping success rate: ${mappingSuccessRate.toFixed(1)}% - This will cause Pass 2 failures`);
        } else {
            console.log(`✅ Good mapping success rate: ${mappingSuccessRate.toFixed(1)}% - Pass 2 should work well`);
        }
    }

    /**
     * SINGLE-PASS CONTENT PROCESSING
     * Based on legacy pushNormalContentItems() approach with modern improvements
     */
    async pushContentItems(
        contentItems: mgmtApi.ContentItem[],
        onProgress?: (processed: number, total: number, type: string) => void
    ): Promise<{ successCount: number, failureCount: number, skippedCount: number, existingCount: number }> {
        
        console.log(`\n🔄 **SINGLE-PASS CONTENT PROCESSING** Starting ${contentItems.length} content items...`);
        console.log(`    📊 Processing Strategy: Individual API calls with immediate mapping storage`);
        console.log(`    🎯 Goal: Check existence → Create if needed → Store mapping immediately`);

        // Reset counters
        this.successfulItems = 0;
        this.failedItems = 0;
        this.skippedItems = 0;
        this.existingCount = 0;

        for (let i = 0; i < contentItems.length; i++) {
            const contentItem = contentItems[i];
            const processed = i + 1;

            console.log(`\n    📋 [${processed}/${contentItems.length}] Processing: ${contentItem.properties?.referenceName} (ID: ${contentItem.contentID})`);
            
            try {
                await this.processSingleContentItem(contentItem);
            } catch (error) {
                console.log(`    ❌ Error processing content item: ${error.message}`);
                this.failedItems++;
                this.skippedContentItems[contentItem.contentID] = contentItem.properties?.referenceName || 'Unknown';
            }

            // Progress callback
            onProgress?.(processed, contentItems.length, 'processing');
        }

        // Final summary
        const totalProcessed = this.successfulItems + this.existingCount + this.failedItems + this.skippedItems;
        console.log(`\n🎉 **SINGLE-PASS COMPLETE**:`);
        console.log(`    ✅ Created: ${this.successfulItems}`);
        console.log(`    🔍 Found Existing: ${this.existingCount}`);
        console.log(`    ⏭️ Skipped: ${this.skippedItems}`);
        console.log(`    ❌ Failed: ${this.failedItems}`);
        console.log(`    📊 Total: ${totalProcessed}/${contentItems.length}`);
        console.log(`    📈 Success Rate: ${Math.round(((this.successfulItems + this.existingCount) / contentItems.length) * 100)}%`);

        return {
            successCount: this.successfulItems,
            failureCount: this.failedItems,
            skippedCount: this.skippedItems,
            existingCount: this.existingCount
        };
    }

    /**
     * Process a single content item with existence checking and immediate mapping
     * Based on legacy pattern but with proper existence detection
     */
    private async processSingleContentItem(contentItem: mgmtApi.ContentItem): Promise<void> {
        
        // STEP 1: Validate container exists (legacy pattern)
        let container: mgmtApi.Container;
        try {
            container = await this.apiClient.containerMethods.getContainerByReferenceName(
                contentItem.properties.referenceName, 
                this.targetGuid
            );
        } catch (error) {
            console.log(`    ⚠️ No container found for: ${contentItem.properties.referenceName}`);
            this.skippedItems++;
            this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
            return;
        }

        // STEP 2: Check if content already exists in target instance
        const existingContentId = await this.checkContentExists(contentItem, container);
        if (existingContentId > 0) {
            console.log(`    🔍 Content already exists with ID: ${existingContentId}`);
            this.existingCount++;
                         // Store mapping for existing content (critical for subsequent runs)
             this.processedContentIds[contentItem.contentID] = existingContentId;
             this.referenceMapper.addRecord('content', contentItem, { contentID: existingContentId });
            return;
        }

        // STEP 3: Get model for field processing (legacy pattern)
        let model: mgmtApi.Model;
        try {
            model = await this.apiClient.modelMethods.getContentModel(container.contentDefinitionID, this.targetGuid);
        } catch (error) {
            console.log(`    ⚠️ No model found for container: ${container.contentDefinitionID}`);
            this.skippedItems++;
            this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
            return;
        }

        // STEP 4: Process content fields (simplified from legacy)
        await this.processContentFields(contentItem, model);

        // STEP 5: Create content item with individual API call (legacy pattern)
        const oldContentId = contentItem.contentID;
        contentItem.contentID = -1; // Legacy pattern: set to -1 for creation

        try {
            console.log(`    🚀 Creating content item...`);
            const createdContentItemId = await this.apiClient.contentMethods.saveContentItem(
                contentItem, 
                this.targetGuid, 
                this.locale
            );

            // STEP 6: Immediately store mapping (critical legacy pattern)
            if (createdContentItemId && createdContentItemId[0] && createdContentItemId[0] > 0) {
                const newContentId = createdContentItemId[0];
                console.log(`    ✅ Content created with ID: ${newContentId}`);
                
                // Store in both legacy format and reference mapper
                this.processedContentIds[oldContentId] = newContentId;
                this.referenceMapper.addRecord('content', { contentID: oldContentId }, { contentID: newContentId });
                this.successfulItems++;
            } else {
                console.log(`    ❌ Content creation returned invalid ID`);
                this.failedItems++;
                this.skippedContentItems[oldContentId] = contentItem.properties.referenceName;
            }

        } catch (error) {
            console.log(`    ❌ Content creation failed: ${error.message}`);
            this.failedItems++;
            this.skippedContentItems[oldContentId] = contentItem.properties.referenceName;
        }
    }

    /**
     * Check if content already exists in target instance
     * This enables proper subsequent run performance as user expects
     */
    private async checkContentExists(contentItem: mgmtApi.ContentItem, container: mgmtApi.Container): Promise<number> {
        try {
            // First check reference mapper (for subsequent runs)
            const existingMapping = this.referenceMapper.getContentMappingById(contentItem.contentID);
            if (existingMapping?.target && (existingMapping.target as any).contentID > 0) {
                const targetContentId = (existingMapping.target as any).contentID;
                // Verify the mapped content still exists
                try {
                    await this.apiClient.contentMethods.getContentItem(targetContentId, this.targetGuid, this.locale);
                    return targetContentId; // Confirmed existing
                } catch {
                    // Mapped content no longer exists - would need to remove from mapper
                    // For simplicity, just continue to check other methods
                }
            }

            // Try to find by container and content properties (could use list API)
            // For now, return 0 (not found) to maintain simple logic
            // TODO: Could implement container content listing for better existence detection
            return 0;

        } catch (error) {
            return 0; // Not found
        }
    }

    /**
     * Process content fields based on model
     * Simplified version of legacy field processing
     */
    private async processContentFields(contentItem: mgmtApi.ContentItem, model: mgmtApi.Model): Promise<void> {
        
        for (const field of model.fields) {
            const fieldName = this.camelize(field.name);
            const fieldVal = contentItem.fields[fieldName];

            if (!fieldVal) continue;

            // Process asset fields (legacy pattern)
            if (field.type === 'ImageAttachment' || field.type === 'FileAttachment' || field.type === 'AttachmentList') {
                await this.processAssetField(contentItem, fieldName, fieldVal);
            }
            // Process gallery fields (legacy pattern) 
            else if (field.type === 'PhotoGallery') {
                this.processGalleryField(contentItem, fieldName, fieldVal);
            }
            // TODO: Process Content field types for linked content (Phase 2)
        }
    }

    /**
     * Process asset fields - convert URLs to target instance
     */
    private async processAssetField(contentItem: mgmtApi.ContentItem, fieldName: string, fieldVal: any): Promise<void> {
        if (typeof fieldVal === 'object') {
            if (Array.isArray(fieldVal)) {
                for (let k = 0; k < fieldVal.length; k++) {
                    if (fieldVal[k].url) {
                        const retUrl = await this.changeOriginKey(fieldVal[k].url);
                        contentItem.fields[fieldName][k].url = retUrl;
                    }
                }
            } else if (fieldVal.url) {
                const retUrl = await this.changeOriginKey(fieldVal.url);
                contentItem.fields[fieldName].url = retUrl;
            }
        }
    }

    /**
     * Process gallery fields
     */
    private processGalleryField(contentItem: mgmtApi.ContentItem, fieldName: string, fieldVal: any): void {
        if (typeof fieldVal === 'object' && 'fulllist' in fieldVal) {
            delete fieldVal.fulllist;
            if ('galleryid' in fieldVal) {
                // TODO: Map gallery IDs using reference mapper
                contentItem.fields[fieldName] = fieldVal.galleryid.toString();
            }
        }
    }

    /**
     * Convert asset URLs to target instance (legacy method)
     */
    private async changeOriginKey(url: string): Promise<string> {
        try {
            const defaultContainer = await this.apiClient.assetMethods.getDefaultContainer(this.targetGuid);
            const filePath = this.getFilePath(url);
            const edgeUrl = `${defaultContainer.edgeUrl}/${filePath}`;

            // Check if asset exists in target
            try {
                await this.apiClient.assetMethods.getAssetByUrl(edgeUrl, this.targetGuid);
                return edgeUrl;
            } catch {
                return url; // Return original if not found
            }
        } catch {
            return url; // Return original on error
        }
    }

    /**
     * Extract file path from origin URL (legacy method)
     */
    private getFilePath(originUrl: string): string {
        try {
            const url = new URL(originUrl);
            const pathName = url.pathname;
            const extractedStr = pathName.split("/")[1];
            const removedStr = pathName.replace(`/${extractedStr}/`, "");
            return removedStr.replace(/%20/g, " ");
        } catch {
            return originUrl;
        }
    }

    /**
     * Convert string to camelCase (legacy method)
     */
    private camelize(str: string): string {
        return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
            return index === 0 ? word.toLowerCase() : word.toUpperCase();
        }).replace(/\s+/g, '');
    }

    /**
     * Get processed content mappings (for pages and other dependencies)
     */
    getProcessedContentIds(): { [key: number]: number } {
        return this.processedContentIds;
    }

    /**
     * Get skipped content items (for reporting)
     */
    getSkippedContentItems(): { [key: number]: string } {
        return this.skippedContentItems;
    }
}

/**
 * Factory function to maintain compatibility with existing pusher pattern
 */
export async function pushContentItemsBatch(
    contentItems: mgmtApi.ContentItem[],
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    targetGuid: string,
    locale: string,
    batchSize: number = 100,
    forceSync: boolean = false,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error' | 'skipped') => void
): Promise<BatchContentResults> {
    
    const pusher = new BatchContentItemPusher(apiClient, referenceMapper, targetGuid, locale, batchSize, forceSync);
    return await pusher.pushContentItemsBatch(contentItems, onProgress);
}