import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../reference-mapper";
import { ContentFieldMapper } from './content-field-mapper';
import { pollBatchUntilComplete, extractBatchResults } from '../batch-polling';
import ansiColors from 'ansi-colors';

/**
 * Configuration for content batch processing
 */
export interface ContentBatchConfig {
    apiClient: mgmtApi.ApiClient;
    targetGuid: string;
    locale: string;
    referenceMapper: ReferenceMapper;
    batchSize?: number; // Default: 100, Max: 250
    useContentFieldMapper?: boolean; // Whether to use enhanced field mapping
    models?: any[]; // Models for enhanced payload preparation
    defaultAssetUrl?: string; // Default asset URL for content mapping
    onBatchComplete?: (batchResult: BatchProcessingResult, batchNumber: number) => Promise<void>; // Callback after each batch completes
}

/**
 * Result of processing a single batch
 */
export interface BatchProcessingResult {
    successCount: number;
    failureCount: number;
    successfulItems: BatchSuccessItem[];
    failedItems: BatchFailedItem[];
}

/**
 * Successful item with original content and new ID
 */
export interface BatchSuccessItem {
    originalContent: mgmtApi.ContentItem;
    newContentId: number;
}

/**
 * Failed item with original content and error details
 */
export interface BatchFailedItem {
    originalContent: mgmtApi.ContentItem;
    error: string;
}

/**
 * Progress callback for batch processing
 */
export type BatchProgressCallback = (
    batchNumber: number,
    totalBatches: number,
    processed: number,
    total: number,
    status: 'processing' | 'success' | 'error'
) => void;

/**
 * Content Batch Processor - Reusable utility for bulk content processing
 * Extracted from topological-two-pass-orchestrator.ts and generalized
 */
export class ContentBatchProcessor {
    private config: ContentBatchConfig;

    constructor(config: ContentBatchConfig) {
        this.config = {
            ...config,
            batchSize: config.batchSize || 250 // Default batch size
        };
    }

    /**
     * Process content items in batches using saveContentItems API
     */
    async processBatches(
        contentItems: mgmtApi.ContentItem[],
        onProgress?: BatchProgressCallback
    ): Promise<BatchProcessingResult> {
        const batchSize = this.config.batchSize!;
        const contentBatches = this.createContentBatches(contentItems, batchSize);
        
        console.log(`Processing ${contentItems.length} content items in ${contentBatches.length} bulk batches (${batchSize} items each)`);
        
        let totalSuccessCount = 0;
        let totalFailureCount = 0;
        const allSuccessfulItems: BatchSuccessItem[] = [];
        const allFailedItems: BatchFailedItem[] = [];
        const startTime = Date.now();

        for (let i = 0; i < contentBatches.length; i++) {
            const contentBatch = contentBatches[i];
            const batchNumber = i + 1;
            const processedSoFar = i * batchSize;
            
            // Calculate ETA for bulk batches
            const elapsed = Date.now() - startTime;
            const avgTimePerBatch = elapsed / batchNumber;
            const remainingBatches = contentBatches.length - batchNumber;
            const etaMs = remainingBatches * avgTimePerBatch;
            const etaMinutes = Math.round(etaMs / 60000);
            
            const progress = Math.round((batchNumber / contentBatches.length) * 100);
            console.log(`[${progress}%] Bulk batch ${batchNumber}/${contentBatches.length}: Processing ${contentBatch.length} content items (ETA: ${etaMinutes}m)...`);
            
            if (onProgress) {
                onProgress(batchNumber, contentBatches.length, processedSoFar, contentItems.length, 'processing');
            }
            
            try {
                // Prepare content payloads for bulk upload
                const contentPayloads = await this.prepareContentPayloads(contentBatch, this.config.models, this.config.defaultAssetUrl);
                
                // Execute bulk upload using saveContentItems API with returnBatchID flag
                const batchIDResult = await this.config.apiClient.contentMethods.saveContentItems(
                    contentPayloads, 
                    this.config.targetGuid, 
                    this.config.locale,
                    true // returnBatchID flag
                );
                
                // Extract batch ID from array response
                const batchID = Array.isArray(batchIDResult) ? batchIDResult[0] : batchIDResult;
                // console.log(`📦 Batch ${batchNumber} started with ID: ${batchID}`);
                
                // Poll batch until completion (pass payloads for error matching)
                const completedBatch = await pollBatchUntilComplete(
                    this.config.apiClient,
                    batchID,
                    this.config.targetGuid,
                    contentPayloads // Pass original payloads for FIFO error matching
                );
                
                // Extract results from completed batch
                const { successfulItems, failedItems } = extractBatchResults(completedBatch, contentBatch);
                
                // Convert to expected format
                const batchResult = {
                    successCount: successfulItems.length,
                    failureCount: failedItems.length,
                    successfulItems: successfulItems.map(item => ({
                        originalContent: item.originalItem,
                        newContentId: item.newId
                    })),
                    failedItems: failedItems.map(item => ({
                        originalContent: item.originalItem,
                        error: item.error
                    }))
                };
                
                totalSuccessCount += batchResult.successCount;
                totalFailureCount += batchResult.failureCount;
                allSuccessfulItems.push(...batchResult.successfulItems);
                allFailedItems.push(...batchResult.failedItems);
                
                // Update ID mappings for successful uploads
                if (batchResult.successfulItems.length > 0) {
                    this.updateContentIdMappings(batchResult.successfulItems);
                }
                
                // Call batch completion callback (for mapping saves, etc.)
                if (this.config.onBatchComplete) {
                    try {
                        await this.config.onBatchComplete(batchResult, batchNumber);
                    } catch (callbackError: any) {
                        console.warn(`⚠️ Batch completion callback failed for batch ${batchNumber}: ${callbackError.message}`);
                        // Don't fail the entire batch due to callback errors
                    }
                }

                console.log(`✅ Bulk batch ${batchNumber}: ${batchResult.successCount} success, ${batchResult.failureCount} failed`);
                
                if (onProgress) {
                    onProgress(batchNumber, contentBatches.length, processedSoFar + contentBatch.length, contentItems.length, 'success');
                }
                
                // Add small delay between batches to prevent API throttling
                if (i < contentBatches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
            } catch (error: any) {
                console.error(`❌ Bulk batch ${batchNumber} failed:`, error.message);
                
                // Fallback: try individual uploads for this batch
                console.log(`🔄 Falling back to individual uploads for batch ${batchNumber}...`);
                const fallbackResult = await this.fallbackToIndividualUploads(contentBatch);
                
                totalSuccessCount += fallbackResult.successCount;
                totalFailureCount += fallbackResult.failureCount;
                allSuccessfulItems.push(...fallbackResult.successfulItems);
                allFailedItems.push(...fallbackResult.failedItems);
                
                if (onProgress) {
                    onProgress(batchNumber, contentBatches.length, processedSoFar + contentBatch.length, contentItems.length, 'error');
                }
            }
        }

        // console.log(`🎯 Content batch processing complete: ${totalSuccessCount} success, ${totalFailureCount} failed`);
        
        return {
            successCount: totalSuccessCount,
            failureCount: totalFailureCount,
            successfulItems: allSuccessfulItems,
            failedItems: allFailedItems
        };
    }

    /**
     * Create batches of content items for bulk processing
     */
    private createContentBatches(contentItems: mgmtApi.ContentItem[], batchSize: number): mgmtApi.ContentItem[][] {
        const batches: mgmtApi.ContentItem[][] = [];
        for (let i = 0; i < contentItems.length; i += batchSize) {
            batches.push(contentItems.slice(i, i + batchSize));
        }
        return batches;
    }

    /**
     * Prepare content payloads for bulk upload API
     * Uses the same payload structure as individual content pusher
     */
    private async prepareContentPayloads(
        contentBatch: mgmtApi.ContentItem[], 
        models?: mgmtApi.Model[], 
        defaultAssetUrl?: string
    ): Promise<any[]> {
        const payloads: any[] = [];
        
        // Import required functions dynamically
        const { findModelInTargetInstance } = await import('../../finders/model-finder');
        const { findContentInTargetInstance } = await import('../../finders/content-item-finder');
        
        for (const contentItem of contentBatch) {
            try {
                // STEP 1: Find source model by content item's definitionName (matching original logic)
                let sourceModel = models?.find(m => m.referenceName === contentItem.properties.definitionName);
                
                // Case-insensitive fallback (matching original logic)
                if (!sourceModel && models) {
                    sourceModel = models.find(m => 
                        m.referenceName.toLowerCase() === contentItem.properties.definitionName.toLowerCase()
                    );
                }
                
                if (!sourceModel) {
                    throw new Error(`Source model not found for content definition: ${contentItem.properties.definitionName}`);
                }
                
                // STEP 2: Find target model using finder (matching original logic)
                const model = await findModelInTargetInstance(sourceModel, this.config.apiClient, this.config.targetGuid, this.config.referenceMapper);
                if (!model) {
                    throw new Error(`Target model not found for: ${sourceModel.referenceName}`);
                }
                
                // STEP 3: Find container using reference mapper first, then API lookup (matching original logic)
                let container;
                const containerMapping = this.config.referenceMapper.getMapping<any>('container', 'referenceName', contentItem.properties.referenceName);
                if (containerMapping?.target) {
                    container = containerMapping.target;
                } else {
                    // Fallback to API lookup if not in mapper
                    try {
                        container = await this.config.apiClient.containerMethods.getContainerByReferenceName(contentItem.properties.referenceName, this.config.targetGuid);
                    } catch (error: any) {
                        console.log(`[Batch] ✗ Container lookup failed: ${contentItem.properties.referenceName} - ${error.message}`);
                    }
                }
                
                if (!container) {
                    throw new Error(`Container not found: ${contentItem.properties.referenceName}`);
                }

                // STEP 4: Check if content already exists (matching original logic)
                const existingContentItem = await findContentInTargetInstance(contentItem, this.config.apiClient, this.config.targetGuid, this.config.locale, this.config.referenceMapper);
                
                // STEP 5: Map the content item fields using reference mapper (essential logic only)
                const mappedFields = this.mapContentReferences(contentItem.fields || {});
                
                // ✅ FIELD VALIDATION: Add default values for required fields to prevent null constraint errors
                let validatedFields = { ...mappedFields };
                
                // Add default values for required fields based on model definition
                if (model && model.fields) {
                    model.fields.forEach(fieldDef => {
                        const fieldName = fieldDef.name;
                        const isRequired = fieldDef.settings?.Required === "True" || fieldDef.settings?.Required === "true";
                        
                        if (isRequired && (validatedFields[fieldName] === undefined || validatedFields[fieldName] === null || validatedFields[fieldName] === "")) {
                            // Provide sensible defaults for required fields based on field type
                            switch (fieldDef.type) {
                                case 'Integer':
                                    validatedFields[fieldName] = 1; // Default to 1 for numeric fields
                                    break;
                                case 'Text':
                                case 'LongText':
                                    validatedFields[fieldName] = "Default Value"; // Default text
                                    break;
                                case 'DropdownList':
                                    // Use the default value from model if available, otherwise use first choice
                                    const defaultValue = fieldDef.settings?.DefaultValue || fieldDef.settings?.["DefaultValue-en-us"];
                                    if (defaultValue) {
                                        validatedFields[fieldName] = defaultValue;
                                    } else if (fieldDef.settings?.Choices) {
                                        const choices = fieldDef.settings.Choices.split('\n');
                                        if (choices.length > 0) {
                                            const firstChoice = choices[0].split('|');
                                            validatedFields[fieldName] = firstChoice.length > 1 ? firstChoice[1] : firstChoice[0];
                                        }
                                    }
                                    break;
                                case 'Boolean':
                                    validatedFields[fieldName] = false; // Default to false for booleans
                                    break;
                                default:
                                    // For other field types, use empty string as fallback
                                    validatedFields[fieldName] = "";
                                    break;
                            }
                            console.log(`🔧 [Batch] Added default value for required field "${fieldName}" (${fieldDef.type}): ${validatedFields[fieldName]}`);
                        }
                    });
                }

                const mappedContentItem = {
                    ...contentItem,
                    fields: validatedFields
                };

                // STEP 6: Define default SEO and Scripts (matching original logic)
                const defaultSeo = { metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null };
                const defaultScripts = { top: null, bottom: null };

                // STEP 7: Create payload using EXACT original logic
                const payload = {
                    ...contentItem, // Start with original content item
                    contentID: existingContentItem ? existingContentItem.contentID : -1,
                    fields: validatedFields, // Use validated fields with defaults for required fields
                    properties: {
                        ...contentItem.properties,
                        referenceName: container.referenceName, // Use TARGET container reference name
                        itemOrder: existingContentItem ? existingContentItem.properties.itemOrder : contentItem.properties.itemOrder
                    },
                    seo: contentItem.seo ?? defaultSeo,
                    scripts: contentItem.scripts ?? defaultScripts
                };
                
                payloads.push(payload);
                
            } catch (error: any) {
                console.error(`[Batch] ✗ Error preparing payload for ${contentItem.properties.referenceName}: ${error.message}`);
                // Skip this item - will be handled as a failed item in the response
                continue;
            }
        }
        
        return payloads;
    }

    /**
     * Map content references in fields using reference mapper
     * Simplified version focused on content references
     */
    private mapContentReferences(fields: any): any {
        if (!fields || typeof fields !== 'object') {
            return fields;
        }

        const mappedFields: any = {};

        for (const [fieldKey, fieldValue] of Object.entries(fields)) {
            if (fieldValue && typeof fieldValue === 'object') {
                if ('contentid' in fieldValue) {
                    // Content reference field - map the contentid
                    const contentid = (fieldValue as any).contentid;
                    const mappedContentId = this.config.referenceMapper.getMappedId('content', contentid);
                    mappedFields[fieldKey] = {
                        ...fieldValue,
                        contentid: mappedContentId || contentid
                    };
                } else if ('contentID' in fieldValue) {
                    // Content reference field - map the contentID  
                    const contentID = (fieldValue as any).contentID;
                    const mappedContentId = this.config.referenceMapper.getMappedId('content', contentID);
                    mappedFields[fieldKey] = {
                        ...fieldValue,
                        contentID: mappedContentId || contentID
                    };
                } else {
                    // Regular object field - copy as-is 
                    mappedFields[fieldKey] = fieldValue;
                }
            } else if (typeof fieldValue === 'string') {
                // Handle special string fields that might contain content IDs
                if ((fieldKey.toLowerCase().includes('categoryid') || fieldKey.toLowerCase().includes('valuefield')) && !isNaN(Number(fieldValue))) {
                    // Numeric string field that might be a content ID reference
                    const mappedContentId = this.config.referenceMapper.getMappedId('content', Number(fieldValue));
                    mappedFields[fieldKey] = mappedContentId?.toString() || fieldValue;
                } else {
                    // Regular string field - copy as-is
                    mappedFields[fieldKey] = fieldValue;
                }
            } else {
                // Primitive field - copy as-is
                mappedFields[fieldKey] = fieldValue;
            }
        }

        return mappedFields;
    }

    /**
     * Process bulk content upload response
     * Handles the actual Agility batch response format with itemID, itemNull, etc.
     */
    private processBulkContentResponse(bulkResult: any, originalBatch: mgmtApi.ContentItem[]): BatchProcessingResult {
        const successfulItems: BatchSuccessItem[] = [];
        const failedItems: BatchFailedItem[] = [];
        
        // DEBUG: Always log the bulk result to understand what we're getting
        console.log('📋 [DEBUG] Bulk Result Type:', typeof bulkResult);
        console.log('📋 [DEBUG] Is Array:', Array.isArray(bulkResult));
        console.log('📋 [DEBUG] Bulk Result:', JSON.stringify(bulkResult, null, 2));
        console.log('📋 [DEBUG] Original Batch Length:', originalBatch.length);
        
        // DEBUG: Check the condition for number array
        const isArray = Array.isArray(bulkResult);
        const isAllNumbers = isArray && bulkResult.every(item => typeof item === 'number');
        console.log('📋 [DEBUG] Is Array:', isArray);
        console.log('📋 [DEBUG] Every item is number:', isAllNumbers);
        
        // DEBUG: Check first few items to see their types
        if (isArray) {
            console.log('📋 [DEBUG] First 5 item types:', bulkResult.slice(0, 5).map(item => typeof item));
        }
        
        if (Array.isArray(bulkResult) && bulkResult.every(item => typeof item === 'number')) {
            console.log('📋 [DEBUG] Processing as Simple Number Array');
            // Simple array of content IDs (legacy format)
            bulkResult.forEach((contentId, index) => {
                if (contentId && typeof contentId === 'number' && contentId > 0) {
                    console.log(`📋 [DEBUG] SUCCESS - Item ${index}: ID=${contentId}`);
                    successfulItems.push({
                        originalContent: originalBatch[index],
                        newContentId: contentId
                    });
                } else {
                    console.log(`📋 [DEBUG] FAILED - Item ${index}: Invalid ID=${contentId}`);
                    failedItems.push({
                        originalContent: originalBatch[index],
                        error: `Invalid content ID returned: ${contentId}`
                    });
                }
            });
        } else if (Array.isArray(bulkResult)) {
            console.log('📋 [DEBUG] Processing as Object Array - Length:', bulkResult.length);
            // Actual Agility batch response: array of batch result objects
            bulkResult.forEach((batchItem, index) => {
                const originalContent = originalBatch[index];
                
                if (!originalContent) {
                    console.warn(`No original content found for batch item ${index}`);
                    return;
                }
                
                // Check for successful batch item
                if (batchItem.itemID && batchItem.itemID > 0 && !batchItem.itemNull) {
                    console.log(`📋 [DEBUG] SUCCESS - Item ${index}: ID=${batchItem.itemID}, itemNull=${batchItem.itemNull}`);
                    successfulItems.push({
                        originalContent,
                        newContentId: batchItem.itemID
                    });
                } else {
                    // Failed batch item
                    console.log(`📋 [DEBUG] FAILED - Item ${index}: ID=${batchItem.itemID}, itemNull=${batchItem.itemNull}, Full Item:`, JSON.stringify(batchItem, null, 2));
                    const errorMessage = batchItem.itemNull 
                        ? `Item upload failed (itemNull=true)` 
                        : `Invalid item ID: ${batchItem.itemID}`;
                    
                    failedItems.push({
                        originalContent,
                        error: errorMessage
                    });
                }
            });
            
            // Handle case where response array is shorter than batch
            if (bulkResult.length < originalBatch.length) {
                for (let i = bulkResult.length; i < originalBatch.length; i++) {
                    failedItems.push({
                        originalContent: originalBatch[i],
                        error: 'No response returned for this item'
                    });
                }
            }
        } else if (bulkResult && typeof bulkResult === 'object' && 'results' in bulkResult) {
            console.log('📋 [DEBUG] Processing as Structured Response with Results Array');
            // Structured response format with results array
            const results = bulkResult.results as any[];
            results.forEach((result, index) => {
                if (result.success && result.contentID > 0) {
                    successfulItems.push({
                        originalContent: originalBatch[index],
                        newContentId: result.contentID
                    });
                } else {
                    failedItems.push({
                        originalContent: originalBatch[index],
                        error: result.error || 'Unknown error'
                    });
                }
            });
        } else {
            // Error response - all items failed
            console.log('📋 [DEBUG] Processing as Error Response - all items failed');
            console.error('📋 [DEBUG] Bulk content upload error:', bulkResult);
            originalBatch.forEach(contentItem => {
                failedItems.push({
                    originalContent: contentItem,
                    error: bulkResult?.message || 'Bulk upload failed'
                });
            });
        }
        
        return {
            successCount: successfulItems.length,
            failureCount: failedItems.length,
            successfulItems,
            failedItems
        };
    }

    /**
     * Update content ID mappings in reference mapper
     */
    private updateContentIdMappings(successfulItems: BatchSuccessItem[]): void {
        successfulItems.forEach(item => {
            const sourceContentItem = item.originalContent;
            const targetContentItem: mgmtApi.ContentItem = {
                ...sourceContentItem,
                contentID: item.newContentId
            };
            
            this.config.referenceMapper.addRecord('content', sourceContentItem, targetContentItem);
            
            // Debug logging for mapping updates
            // console.log(`🔗 Content mapping: ${sourceContentItem.contentID} → ${item.newContentId}`);
        });
    }

    /**
     * Fallback to individual content uploads when bulk fails
     */
    private async fallbackToIndividualUploads(contentBatch: mgmtApi.ContentItem[]): Promise<BatchProcessingResult> {
        const successfulItems: BatchSuccessItem[] = [];
        const failedItems: BatchFailedItem[] = [];
        
        console.log(`🔄 Processing ${contentBatch.length} items individually...`);
        
        for (const contentItem of contentBatch) {
            try {
                const payloads = await this.prepareContentPayloads([contentItem]);
                
                // Use saveContentItem with returnBatchID flag for SDK v1.30 polling
                const batchIDResult = await this.config.apiClient.contentMethods.saveContentItem(
                    payloads[0], 
                    this.config.targetGuid, 
                    this.config.locale,
                    true // returnBatchID flag
                );
                
                // Extract batch ID from response
                const batchID = Array.isArray(batchIDResult) ? batchIDResult[0] : batchIDResult;
                
                // Poll batch until completion (pass payload for error matching)
                const completedBatch = await pollBatchUntilComplete(
                    this.config.apiClient,
                    batchID,
                    this.config.targetGuid,
                    payloads // Pass prepared payload for FIFO error matching
                );
                
                // Extract result from completed batch
                const { successfulItems: itemResults, failedItems: itemErrors } = extractBatchResults(completedBatch, [contentItem]);
                
                if (itemResults.length > 0) {
                    successfulItems.push({
                        originalContent: contentItem,
                        newContentId: itemResults[0].newId
                    });
                    console.log(`✓ Individual upload: ${contentItem.properties.referenceName} → ID:${itemResults[0].newId}`);
                } else {
                    const errorMessage = itemErrors.length > 0 ? itemErrors[0].error : 'Unknown error';
                    failedItems.push({
                        originalContent: contentItem,
                        error: errorMessage
                    });
                    console.log(`✗ Individual upload failed: ${contentItem.properties.referenceName} - ${errorMessage}`);
                }
                
            } catch (error: any) {
                console.error(`✗ Individual content upload failed for ${contentItem.properties.referenceName}:`, error.message);
                failedItems.push({
                    originalContent: contentItem,
                    error: error.message
                });
            }
        }
        
        // Update mappings for successful individual uploads
        if (successfulItems.length > 0) {
            this.updateContentIdMappings(successfulItems);
        }
        
        return {
            successCount: successfulItems.length,
            failureCount: failedItems.length,
            successfulItems,
            failedItems
        };
    }
} 