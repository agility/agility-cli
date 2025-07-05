import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import { pollBatchUntilComplete, extractBatchResults } from '../shared/batch-polling';
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
    publishableIds: number[]; // Target content IDs for auto-publishing
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
                    })),
                    publishableIds: successfulItems.map(item => item.newId)
                };
                
                totalSuccessCount += batchResult.successCount;
                totalFailureCount += batchResult.failureCount;
                allSuccessfulItems.push(...batchResult.successfulItems);
                allFailedItems.push(...batchResult.failedItems);
                
                // Update ID mappings for successful uploads
                if (batchResult.successfulItems.length > 0) {
                    this.updateContentIdMappings(batchResult.successfulItems);
                }
                
                // Display individual item results for better visibility
                if (batchResult.successfulItems.length > 0) {
                    console.log(`✅ Batch ${batchNumber} successful items:`);
                    batchResult.successfulItems.forEach(item => {
                        const modelName = item.originalContent.properties.definitionName || 'Unknown';
                        console.log(`  ✓ Linked content: ${item.originalContent.properties.referenceName} (${modelName}) - Source: ${item.originalContent.contentID} Target: ${item.newContentId}`);
                    });
                }
                
                if (batchResult.failedItems.length > 0) {
                    console.log(`❌ Batch ${batchNumber} failed items:`);
                    batchResult.failedItems.forEach(item => {
                        const modelName = item.originalContent.properties.definitionName || 'Unknown';
                        console.log(`  ✗ Failed: ${item.originalContent.properties.referenceName} (${modelName}) - ${item.error}`);
                    });
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

                console.log(`✅ Batch ${batchNumber} completed successfully`);
                
                if (onProgress) {
                    onProgress(batchNumber, contentBatches.length, processedSoFar + contentBatch.length, contentItems.length, 'success');
                }
                
                // Add small delay between batches to prevent API throttling
                if (i < contentBatches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
            } catch (error: any) {
                console.error(`❌ Bulk batch ${batchNumber} failed:`, error.message);
                
                // Batch pusher only handles batches - mark entire batch as failed
                // Individual processing fallbacks should be handled at the sync level
                const failedBatchItems: BatchFailedItem[] = contentBatch.map(item => ({
                    originalContent: item,
                    error: `Batch processing failed: ${error.message}`
                }));
                
                totalFailureCount += failedBatchItems.length;
                allFailedItems.push(...failedBatchItems);
                
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
            failedItems: allFailedItems,
            publishableIds: allSuccessfulItems.map(item => item.newContentId)
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
        const { findModelInTargetInstance } = await import('../finders/model-finder');
        const { findContentInTargetInstance } = await import('../finders/content-item-finder');
        
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
                
                // STEP 5: Use proper ContentFieldMapper for field mapping and validation
                const { ContentFieldMapper } = await import('../content/content-field-mapper');
                const fieldMapper = new ContentFieldMapper();
                
                const mappingResult = fieldMapper.mapContentFields(contentItem.fields || {}, {
                    referenceMapper: this.config.referenceMapper,
                    apiClient: this.config.apiClient,
                    targetGuid: this.config.targetGuid
                });
                
                // Only log field mapper issues if there are actual errors (not warnings)
                if (mappingResult.validationErrors > 0) {
                    console.warn(`⚠️ Field mapping errors for ${contentItem.properties.referenceName}: ${mappingResult.validationErrors} errors`);
                }
                
                // STEP 6: Normalize field names and add defaults ONLY for truly missing required fields
                let validatedFields = { ...mappingResult.mappedFields };
                
                // Create field name mapping: source field names (camelCase) to model field names (as-defined)
                const fieldNameMap = new Map<string, string>();
                const camelize = (str: string): string => {
                    return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
                        return index === 0 ? word.toLowerCase() : word.toUpperCase();
                    }).replace(/\s+/g, '');
                };
                
                if (model && model.fields) {
                    model.fields.forEach(fieldDef => {
                        const camelCaseFieldName = camelize(fieldDef.name);
                        fieldNameMap.set(camelCaseFieldName, fieldDef.name);
                        fieldNameMap.set(fieldDef.name.toLowerCase(), fieldDef.name);
                    });
                }
                
                // No field processing needed - use source data as-is

                const mappedContentItem = {
                    ...contentItem,
                    fields: validatedFields
                };

                // STEP 7: Define default SEO and Scripts (matching original logic)
                const defaultSeo = { metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null };
                const defaultScripts = { top: null, bottom: null };

                // STEP 8: Create payload using EXACT original logic
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

} 