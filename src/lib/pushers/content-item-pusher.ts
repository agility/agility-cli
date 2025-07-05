import { ReferenceMapper } from "../shared/reference-mapper";
import * as mgmtApi from '@agility/management-sdk';
import { 
  findContentInTargetInstance, 
  findContainerInTargetInstance, 
  findModelInTargetInstance 
} from "../finders";
import ansiColors from "ansi-colors";
import { 
  ContentClassifier, 
  type ContentClassification,
  ContentFieldMapper
} from '../shared';
// Removed ContentBatchProcessor import - individual pusher only handles individual processing
import { state } from '../../core/state';


/**
 * Content Item Pusher - implements the proven push_legacy.ts pattern
 * 
 * Based on push_legacy.ts logic:
 * 1. Classify content into normal vs linked
 * 2. Process normal content first (single pass, no dependencies)
 * 3. Process linked content with do-while loop (dependency resolution)
 */

// Enhanced content item mapping using sophisticated field mapper
async function mapContentItem(
    contentItem: mgmtApi.ContentItem,
    referenceMapper: ReferenceMapper,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    defaultAssetUrl: string,
    models: mgmtApi.Model[]
): Promise<mgmtApi.ContentItem> {
    // Import the enhanced field mapper
    const { ContentFieldMapper } = await import('../content/content-field-mapper');
    
    const fieldMapper = new ContentFieldMapper();
    
    // Get source and target assets from reference mapper for URL mapping
    const sourceAssets: any[] = [];
    const targetAssets: any[] = [];
    
    // Extract source and target assets from the reference mapper records
    const assetMappings = referenceMapper.getRecordsByType('asset');
    assetMappings.forEach(mapping => {
        if (mapping.source) {
            sourceAssets.push(mapping.source);
        }
        if (mapping.target) {
            targetAssets.push(mapping.target);
        }
    });
    
    // Map the content item fields using enhanced reference transformation
    const mappingResult = fieldMapper.mapContentFields(contentItem.fields, {
        referenceMapper,
        sourceAssets,
        targetAssets,
        apiClient,
        targetGuid
    });

    // Only log field mapper issues if there are actual errors (not warnings)
    if (mappingResult.validationErrors > 0) {
        console.warn(`⚠️ Field mapping errors for ${contentItem.properties.referenceName}: ${mappingResult.validationErrors} errors`);
    }
    // Only log success for items with issues (keep logs clean)
    // Success cases are logged at the content push level

    return {
        ...contentItem,
        fields: mappingResult.mappedFields
    };
}

// Helper function to get default asset container URL
async function getDefaultAssetContainerUrl(apiClient: mgmtApi.ApiClient, targetGuid: string): Promise<string | null> {
    try {
        const defaultContainer = await apiClient.assetMethods.getDefaultContainer(targetGuid);
        const defaultUrl = defaultContainer?.originUrl || null;
        if (!defaultUrl) {
            // console.warn(ansiColors.yellow(`[Content Pusher] Could not retrieve default asset container origin URL for target GUID ${targetGuid}. Asset URL mapping might be incomplete.`));
        }
        return defaultUrl;
    } catch (err: any) {
        console.error(ansiColors.red(`[Content Pusher] Error fetching default asset container for target GUID ${targetGuid}: ${err.message}`));
        return null; 
    }
}



/**
 * MAIN INDIVIDUAL PROCESSING FUNCTION - mirrors saveContentItem SDK pattern
 * Processes normal content items individually with proper field mapping and dependency handling
 */
async function pushNormalContentItemsIndividual(
    normalContentItems: mgmtApi.ContentItem[],
    targetGuid: string,
    locale: string,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    models: mgmtApi.Model[],
    defaultAssetUrl: string,
    onProgress?: (processed: number, total: number, item: string, status: 'success' | 'error') => void
): Promise<{ successfulItems: number, failedItems: number, publishableIds: number[] }> {
    
    let successfulItems = 0;
    let failedItems = 0;
    
    console.log(ansiColors.cyan(`[Content Pusher] Processing ${normalContentItems.length} normal content items individually`));
    
    for (let i = 0; i < normalContentItems.length; i++) {
        const contentItem = normalContentItems[i];
        const itemName = contentItem.properties.referenceName || 'Unknown';
        
        try {
            // Check if content item already exists in target
            const existingContentItem = await findContentInTargetInstance(contentItem, apiClient, targetGuid, locale, referenceMapper);
            
            if (existingContentItem && !state.overwrite) {
                // Skip if already exists and not overwriting
                console.log(ansiColors.gray(`[Content Pusher] ↷ Skipping ${itemName}: already exists in target (use --overwrite to update)`));
                continue;
            }
            
            // Map content item fields using enhanced field mapping
            const mappedItem = await mapContentItem(
                contentItem,
                referenceMapper,
                apiClient,
                targetGuid,
                defaultAssetUrl,
                models
            );
            
            // Save individual content item
            console.log(ansiColors.cyan(`[Content Pusher] → Processing ${itemName} (${i + 1}/${normalContentItems.length})`));
            const result = await apiClient.contentMethods.saveContentItem(mappedItem, targetGuid, locale);
            
            // Extract content ID and update mappings
            const newContentId = extractContentId(result);
            if (newContentId > 0) {
                // Add mapping to reference mapper
                referenceMapper.addMapping(
                    'content',
                    contentItem,
                    { contentID: newContentId, properties: { referenceName: itemName } }
                );
                
                successfulItems++;
                console.log(ansiColors.green(`[Content Pusher] ✓ ${itemName}: Source ID ${contentItem.contentID} → Target ID ${newContentId}`));
                
                // Update progress
                if (onProgress) {
                    onProgress(i + 1, normalContentItems.length, itemName, 'success');
                }
            } else {
                failedItems++;
                console.log(ansiColors.red(`[Content Pusher] ✗ ${itemName}: Failed to extract content ID from response`));
                
                // Update progress
                if (onProgress) {
                    onProgress(i + 1, normalContentItems.length, itemName, 'error');
                }
            }
            
        } catch (error: any) {
            failedItems++;
            console.error(ansiColors.red(`[Content Pusher] ✗ ${itemName}: ${error.message}`));
            
            // Update progress
            if (onProgress) {
                onProgress(i + 1, normalContentItems.length, itemName, 'error');
            }
        }
    }
    
    // Save mappings after individual processing
    console.log(ansiColors.gray(`💾 Saving mappings after individual processing...`));
    try {
        await referenceMapper.saveAllMappings();
        console.log(ansiColors.gray(`✅ Mappings saved successfully`));
    } catch (saveError: any) {
        console.warn(ansiColors.yellow(`⚠️ Failed to save mappings: ${saveError.message}`));
    }
    
    console.log(ansiColors.green(`✅ Individual processing complete: ${successfulItems} successful, ${failedItems} failed`));
    
    return {
        successfulItems,
        failedItems,
        publishableIds: [] // Individual processing - publishableIds handled by calling code
    };
}

/**
 * Process normal content items using individual processing (mirrors saveContentItem SDK pattern)
 * This function handles individual content item processing only.
 */
async function pushNormalContentItems(
    normalContentItems: mgmtApi.ContentItem[],
    targetGuid: string,
    locale: string,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    models: mgmtApi.Model[],
    defaultAssetUrl: string,
    onProgress?: (processed: number, total: number, item: string, status: 'success' | 'error') => void
): Promise<{ successfulItems: number, failedItems: number, publishableIds: number[] }> {
    
    // This function now only handles individual processing (mirrors saveContentItem)
    console.log(ansiColors.cyan(`[Content Pusher] Processing ${normalContentItems.length} normal content items individually`));
    
    const result = await pushNormalContentItemsIndividual(
        normalContentItems,
        targetGuid,
        locale,
        apiClient,
        referenceMapper,
        models,
        defaultAssetUrl,
        onProgress
    );
    
    return {
        ...result,
        publishableIds: [] // Individual processing - publishableIds should be handled by calling code
    };
}

/**
 * Process linked content items using individual processing with dependency resolution
 * Handles individual content item processing with dependency resolution logic.
 */
async function processLinkedContentIndividually(
    linkedContentItems: mgmtApi.ContentItem[],
    targetGuid: string,
    locale: string,
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    models: mgmtApi.Model[],
    defaultAssetUrl: string,
    onProgress?: (processed: number, total: number, item: string, status: 'success' | 'error') => void
): Promise<{ successfulItems: number, failedItems: number, publishableIds: number[] }> {

    let successfulItems = 0;
    let failedItems = 0;
    const publishableIds: number[] = [];
    const skippedContentItems: { [key: number]: string } = {}; // Track skipped items
    
    // Create a working copy of linked content items
    let remainingContentItems = [...linkedContentItems];
    let totalProcessed = 0;
    const maxAttempts = remainingContentItems.length * 2; // Prevent infinite loops
    let attemptCount = 0;

    console.log(ansiColors.cyan(`[Content Pusher] Processing ${linkedContentItems.length} linked content items individually with dependency resolution`));

    // Legacy do-while pattern: keep processing until no more progress
    do {
        const beforeCount = remainingContentItems.length;
        attemptCount++;

        console.log(ansiColors.gray(`[Content Pusher] Individual processing pass ${attemptCount}: ${remainingContentItems.length} items remaining`));

        // Process items individually with dependency checking
        const processedInThisPass: number[] = [];
        
        for (let i = 0; i < remainingContentItems.length; i++) {
            const contentItem = remainingContentItems[i];
            const itemName = contentItem.properties.referenceName || 'Unknown';
            
            // Skip if already marked as problematic
            if (skippedContentItems[contentItem.contentID]) {
                continue;
            }
            
            try {
                // Find source model by content item's definitionName
                let sourceModel = models.find(m => m.referenceName === contentItem.properties.definitionName);
                
                // Case-insensitive lookup if exact match fails
                if (!sourceModel) {
                    sourceModel = models.find(m => 
                        m.referenceName.toLowerCase() === contentItem.properties.definitionName.toLowerCase()
                    );
                }
                
                if (!sourceModel) {
                    skippedContentItems[contentItem.contentID] = `Model not found: ${contentItem.properties.definitionName}`;
                    console.log(ansiColors.red(`✗ Linked content ${itemName} failed - source model not found: ${contentItem.properties.definitionName}`));
                    failedItems++;
                    continue;
                }

                // Check if all dependencies are resolved
                if (!areContentDependenciesResolved(contentItem, referenceMapper, [sourceModel])) {
                    // Dependencies not ready - skip for this pass
                    continue;
                }

                // Find target model
                const targetModel = await findModelInTargetInstance(sourceModel, apiClient, targetGuid, referenceMapper);
                if (!targetModel) {
                    skippedContentItems[contentItem.contentID] = `Target model not found: ${sourceModel.referenceName}`;
                    console.log(ansiColors.red(`✗ Linked content ${itemName} failed - target model not found: ${sourceModel.referenceName}`));
                    failedItems++;
                    continue;
                }

                // Find container
                const containerMapping = referenceMapper.getMapping<mgmtApi.Container>('container', 'referenceName', contentItem.properties.referenceName);
                let container: mgmtApi.Container | undefined;
                
                if (containerMapping?.target) {
                    container = containerMapping.target;
                } else {
                    try {
                        container = await apiClient.containerMethods.getContainerByReferenceName(contentItem.properties.referenceName, targetGuid);
                    } catch (error: any) {
                        console.log(`[Content Push] ✗ Container lookup failed: ${contentItem.properties.referenceName} - ${error.message}`);
                    }
                }
                
                if (!container) {
                    skippedContentItems[contentItem.contentID] = `Container not found: ${contentItem.properties.referenceName}`;
                    console.log(ansiColors.red(`✗ Linked content ${itemName} failed - container not found: ${contentItem.properties.referenceName}`));
                    failedItems++;
                    continue;
                }

                // Check if content already exists
                const existingContentItem = await findContentInTargetInstance(contentItem, apiClient, targetGuid, locale, referenceMapper);
                
                            if (existingContentItem && !state.overwrite) {
                    console.log(ansiColors.gray(`[Content Pusher] ↷ Skipping ${itemName}: already exists in target (use --overwrite to update)`));
                    processedInThisPass.push(contentItem.contentID);
                    continue;
                }

                // Map content item fields
                const mappedItem = await mapContentItem(
                    contentItem,
                    referenceMapper,
                    apiClient,
                    targetGuid,
                    defaultAssetUrl,
                    models
                );

                // Save individual content item
                console.log(ansiColors.cyan(`[Content Pusher] → Processing linked content ${itemName} (pass ${attemptCount})`));
                const result = await apiClient.contentMethods.saveContentItem(mappedItem, targetGuid, locale);

                // Extract content ID and update mappings
                const newContentId = extractContentId(result);
                if (newContentId > 0) {
                    // Add mapping to reference mapper
                    referenceMapper.addMapping(
                        'content',
                        contentItem,
                        { contentID: newContentId, properties: { referenceName: itemName } }
                    );
                    
                    successfulItems++;
                    totalProcessed++;
                    publishableIds.push(newContentId);
                    processedInThisPass.push(contentItem.contentID);
                    
                    console.log(ansiColors.green(`[Content Pusher] ✓ ${itemName}: Source ID ${contentItem.contentID} → Target ID ${newContentId}`));
                    
                    // Update progress
                    if (onProgress) {
                        onProgress(totalProcessed, linkedContentItems.length, itemName, 'success');
                    }
                } else {
                    failedItems++;
                    console.log(ansiColors.red(`[Content Pusher] ✗ ${itemName}: Failed to extract content ID from response`));
                    
                    // Update progress
                    if (onProgress) {
                        onProgress(totalProcessed, linkedContentItems.length, itemName, 'error');
                    }
                }
                
            } catch (error: any) {
                console.error(ansiColors.red(`[Content Pusher] ✗ ${itemName}: ${error.message}`));
                failedItems++;
                
                // Update progress
                if (onProgress) {
                    onProgress(totalProcessed, linkedContentItems.length, itemName, 'error');
                }
            }
        }

        // Remove processed items from remaining list
        remainingContentItems = remainingContentItems.filter(item => !processedInThisPass.includes(item.contentID));

        // Check for infinite loop protection
        if (attemptCount >= maxAttempts) {
            console.warn(ansiColors.yellow(`[Content Pusher] ⚠️ Max attempts (${maxAttempts}) reached. Stopping to prevent infinite loop.`));
            
            // Mark remaining items as failed due to unresolved dependencies
            for (const item of remainingContentItems) {
                if (!skippedContentItems[item.contentID]) {
                    const itemName = item.properties.referenceName || 'Unknown';
                    console.log(ansiColors.red(`✗ ${itemName}: Failed due to unresolved dependencies after ${maxAttempts} attempts`));
                    failedItems++;
                }
            }
            break;
        }

        // Check for progress
        if (processedInThisPass.length === 0 && remainingContentItems.length > 0) {
            console.warn(ansiColors.yellow(`[Content Pusher] ⚠️ No progress made in pass ${attemptCount}. Stopping to prevent infinite loop.`));
            
            // Mark remaining items as failed
            for (const item of remainingContentItems) {
                if (!skippedContentItems[item.contentID]) {
                    const itemName = item.properties.referenceName || 'Unknown';
                    console.log(ansiColors.red(`✗ ${itemName}: Failed due to unresolved dependencies (no progress possible)`));
                    failedItems++;
                }
            }
            break;
        }

    } while (remainingContentItems.length > 0);

    // Save mappings after individual processing
    console.log(ansiColors.gray(`💾 Saving mappings after individual linked content processing...`));
    try {
        await referenceMapper.saveAllMappings();
        console.log(ansiColors.gray(`✅ Mappings saved successfully`));
    } catch (saveError: any) {
        console.warn(ansiColors.yellow(`⚠️ Failed to save mappings: ${saveError.message}`));
    }
    
    console.log(ansiColors.green(`✅ Individual linked content processing complete: ${successfulItems} successful, ${failedItems} failed`));
    
    return {
        successfulItems,
        failedItems,
        publishableIds
    };
}

/**
 * Process linked content items with individual processing and dependency resolution
 * Handles all linked content items individually with dependency resolution logic.
 */
// async function pushLinkedContentItemsBatch(
//     linkedContentItems: mgmtApi.ContentItem[],
//     targetGuid: string,
//     locale: string,
//     apiClient: mgmtApi.ApiClient,
//     referenceMapper: ReferenceMapper,
//     models: mgmtApi.Model[],
//     defaultAssetUrl: string,
//     onProgress?: (processed: number, total: number, item: string, status: 'success' | 'error') => void
// ): Promise<{ successfulItems: number, failedItems: number, publishableIds: number[] }> {

//     // Check for --no-batch flag and route to individual processing only
//     const state = getState();
//     if (state.noBatch) {
//         console.log(ansiColors.cyan(`[Content Pusher] --no-batch flag enabled, processing ${linkedContentItems.length} linked content items individually with dependency resolution`));
        
//         return await processLinkedContentIndividually(
//             linkedContentItems,
//             targetGuid,
//             locale,
//             apiClient,
//             referenceMapper,
//             models,
//             defaultAssetUrl,
//             onProgress
//         );
//     }

//     let successfulItems = 0;
//     let failedItems = 0;
//     const publishableIds: number[] = []; // Collect target content IDs for auto-publishing
//     const skippedContentItems: { [key: number]: string } = {}; // Track skipped items like legacy
    
//     // Create a working copy of linked content items
//     let remainingContentItems = [...linkedContentItems];
//     let totalProcessed = 0;
//     const maxAttempts = remainingContentItems.length * 2; // Prevent infinite loops
//     let attemptCount = 0;

//     console.log(ansiColors.cyan(`[Content Pusher] Processing ${linkedContentItems.length} linked content items (BATCH-OPTIMIZED with dependency resolution)`));

//     // Legacy do-while pattern: keep processing until no more progress
//     do {
//         const beforeCount = remainingContentItems.length;
//         attemptCount++;

//         console.log(ansiColors.gray(`[Content Pusher] Linked content pass ${attemptCount}: ${remainingContentItems.length} items remaining`));

//         // Step 1: Pre-filter items with resolved dependencies for processing
//         const readyForProcessing: mgmtApi.ContentItem[] = [];
//         const needsDependencyResolution: mgmtApi.ContentItem[] = [];
        
//         for (const contentItem of remainingContentItems) {
//             // Skip if already marked as problematic
//             if (skippedContentItems[contentItem.contentID]) {
//                 needsDependencyResolution.push(contentItem);
//                 continue;
//             }
            
//             // Find the model for dependency checking
//             let sourceModel = models.find(m => m.referenceName === contentItem.properties.definitionName);
            
//             // 🚨 CASE SENSITIVITY FIX: Try case-insensitive lookup if exact match fails
//             if (!sourceModel) {
//                 sourceModel = models.find(m => 
//                     m.referenceName.toLowerCase() === contentItem.properties.definitionName.toLowerCase()
//                 );
//             }
            
//             if (!sourceModel) {
//                 // Mark as problematic and skip
//                 skippedContentItems[contentItem.contentID] = `Model not found: ${contentItem.properties.definitionName}`;
//                 needsDependencyResolution.push(contentItem);
//                 continue;
//             }
            
//             // Check if all dependencies are resolved
//             if (areContentDependenciesResolved(contentItem, referenceMapper, [sourceModel])) {
//                 readyForProcessing.push(contentItem);
//             } else {
//                 needsDependencyResolution.push(contentItem);
//             }
//         }

//         console.log(ansiColors.gray(`[Content Pusher] Pass ${attemptCount}: ${readyForProcessing.length} ready for processing, ${needsDependencyResolution.length} need individual processing`));

//         // Step 2: Process ready items individually (individual pusher only handles individual processing)
//         if (readyForProcessing.length > 0) {
//             console.log(ansiColors.cyan(`[Content Pusher] Processing ${readyForProcessing.length} ready linked content items individually...`));
            
//             // Add ready items to individual processing queue
//             needsDependencyResolution.push(...readyForProcessing);
//         }

//         // Step 3: Process remaining items individually (original dependency resolution logic)
//         const processedInThisPass: number[] = [];
        
//         for (let i = 0; i < needsDependencyResolution.length; i++) {
//             const contentItem = needsDependencyResolution[i];
//             const itemName = contentItem.properties.referenceName || 'Unknown';
            
//             // Skip if already marked as problematic
//             if (skippedContentItems[contentItem.contentID]) {
//                 continue;
//             }
            
//             let container: mgmtApi.Container | undefined;
//             let model: mgmtApi.Model | undefined;
//             let payload: mgmtApi.ContentItem | undefined;

//             try {
//                 // SIMPLIFIED: Use same working pusher pattern as normal content
                
//                 // Step 1: Find source model by content item's definitionName (like model pusher)
//                 let sourceModel = models.find(m => m.referenceName === contentItem.properties.definitionName);
                
//                 // 🚨 CASE SENSITIVITY FIX: Try case-insensitive lookup if exact match fails
//                 if (!sourceModel) {
//                     sourceModel = models.find(m => 
//                         m.referenceName.toLowerCase() === contentItem.properties.definitionName.toLowerCase()
//                     );
//                     if (sourceModel) {
//                         console.log(`[Content Push] ⚠️ Case-insensitive model match: "${contentItem.properties.definitionName}" → "${sourceModel.referenceName}"`);
//                     }
//                 }
                
//                 if (!sourceModel) {
//                     throw new Error(`Source model not found for content definition: ${contentItem.properties.definitionName}`);
//                 }
                
//                 // Step 2: Find target model using finder (like model pusher pattern)
//                 model = await findModelInTargetInstance(sourceModel, apiClient, targetGuid, referenceMapper);
//                 if (!model) {
//                     console.log(ansiColors.red(`✗ Linked content ${itemName} failed - target model not found: ${sourceModel.referenceName}`));
//                     skippedContentItems[contentItem.contentID] = itemName;
//                     failedItems++;
//                     if (onProgress) onProgress(totalProcessed, linkedContentItems.length, itemName, 'error');
//                     continue;
//                 }
                
//                 // Step 3: Find container using reference mapper first, then API lookup
//                 // Check reference mapper for existing container mapping
//                 const containerMapping = referenceMapper.getMapping<mgmtApi.Container>('container', 'referenceName', contentItem.properties.referenceName);
//                 if (containerMapping?.target) {
//                     container = containerMapping.target;
//                     console.log(`[Content Push] ✓ Found container in cache: ${contentItem.properties.referenceName} → ID:${container.contentViewID}`);
//                 } else {
//                     // Fallback to API lookup if not in mapper
//                     try {
//                         container = await apiClient.containerMethods.getContainerByReferenceName(contentItem.properties.referenceName, targetGuid);
//                         console.log(`[Content Push] ✓ Found container by API: ${contentItem.properties.referenceName} → ID:${container.contentViewID}`);
//                     } catch (error: any) {
//                         console.log(`[Content Push] ✗ Container lookup failed: ${contentItem.properties.referenceName} - ${error.message}`);
//                     }
//                 }
                
//                 if (!container) {
//                     throw new Error(`Container not found: ${contentItem.properties.referenceName}`);
//                 }

//                 // Check if all dependencies are resolved
//                 if (!areContentDependenciesResolved(contentItem, referenceMapper, [model])) {
//                     // Dependencies not ready - skip for this pass
//                     continue;
//                 }

//                 // Check if content already exists
//                 const existingContentItem = await findContentInTargetInstance(contentItem, apiClient, targetGuid, locale, referenceMapper);
                
//                 // Map the content item using enhanced field mapper with the validated model
//                 const mappedContentItem = await mapContentItem(
//                     contentItem, 
//                     referenceMapper,
//                     apiClient,
//                     targetGuid,
//                     defaultAssetUrl,
//                     [model] // Pass the specific model from container
//                 );

//                 // Define default SEO and Scripts
//                 const defaultSeo: mgmtApi.SeoProperties = { metaDescription: null, metaKeywords: null, metaHTML: null, menuVisible: null, sitemapVisible: null };
//                 const defaultScripts: mgmtApi.ContentScripts = { top: null, bottom: null };

//                 // Use mapped fields as-is - no default field addition needed
//                 let validatedFields = { ...mappedContentItem.fields };

//                 // 🚨 ASSET URL MAPPING: Process all ImageAttachment/FileAttachment/AttachmentList fields
//                 // Based on legacy push.ts pattern - scan ALL fields for asset attachments
//                 if (model && model.fields) {
//                     for (let j = 0; j < model.fields.length; j++) {
//                         const field = model.fields[j];
//                         const fieldName = field.name;
//                         const fieldVal = validatedFields[fieldName];

//                         if (field.type === 'ImageAttachment' || field.type === 'FileAttachment' || field.type === 'AttachmentList') {
//                             if (typeof fieldVal === 'object' && fieldVal !== null) {
//                                 // Asset URL mapping will be handled by the existing field mapper
//                                 // This preserves the existing asset field structure
//                                 validatedFields[fieldName] = fieldVal;
//                             }
//                         }
//                     }
//                 }

//                 payload = {
//                     ...contentItem, // Start with original content item
//                     contentID: existingContentItem ? existingContentItem.contentID : -1,
//                     fields: validatedFields, // Use fields with URL name properties fixed
//                     properties: {
//                         ...contentItem.properties,
//                         // 🚨 CRITICAL FIX: Use target container's actual reference name instead of source content item's reference name
//                         referenceName: container.referenceName, // Use TARGET container reference name
//                         itemOrder: existingContentItem ? existingContentItem.properties.itemOrder : contentItem.properties.itemOrder
//                     },
//                     seo: contentItem.seo ?? defaultSeo,
//                     scripts: contentItem.scripts ?? defaultScripts
//                 };

//                 // Use saveContentItem with returnBatchID flag for SDK v1.30 polling
//                 const batchIDResult = await apiClient.contentMethods.saveContentItem(payload, targetGuid, locale, true);
                
//                 // Extract batch ID from response
//                 const batchID = Array.isArray(batchIDResult) ? batchIDResult[0] : batchIDResult;
//                 console.log(`📦 Linked content ${itemName} started with batch ID: ${batchID}`);
                
//                 // Poll batch until completion (pass payload for error matching)
//                 const { pollBatchUntilComplete, extractBatchResults } = await import('../utilities/batch-polling');
//                 const completedBatch = await pollBatchUntilComplete(
//                     apiClient,
//                     batchID,
//                     targetGuid,
//                     [payload] // Pass payload for FIFO error matching
//                 );
                
//                 // Extract result from completed batch
//                 const { successfulItems: batchSuccessItems, failedItems: batchFailedItems } = extractBatchResults(completedBatch, [contentItem]);
                
//                 let actualContentId = -1;
//                 if (batchSuccessItems.length > 0) {
//                     actualContentId = batchSuccessItems[0].newId;
//                 } else if (batchFailedItems.length > 0) {
//                     console.log(ansiColors.red(`✗ Linked content ${itemName} batch failed: ${batchFailedItems[0].error}`));
//                 }
                
//                 if (actualContentId > 0) {
//                     // Success case
//                     const targetContentItem: mgmtApi.ContentItem = {
//                         ...payload,
//                         contentID: actualContentId
//                     };
                    
//                     referenceMapper.addRecord('content', contentItem, targetContentItem);
//                     console.log(`✓ Linked content: ${itemName} (${model.referenceName}) - Source: ${contentItem.contentID} Target: ${actualContentId}`);
//                     successfulItems++;
//                     publishableIds.push(actualContentId); // Collect target ID for auto-publishing
//                     processedInThisPass.push(contentItem.contentID);
//                     totalProcessed++;
                    
//                     if (onProgress) onProgress(totalProcessed, linkedContentItems.length, itemName, 'success');
//                 } else {
//                     console.log(ansiColors.red(`✗ Linked content ${itemName} failed - no valid content ID returned`));
//                     skippedContentItems[contentItem.contentID] = itemName;
//                     failedItems++;
//                     if (onProgress) onProgress(totalProcessed, linkedContentItems.length, itemName, 'error');
//                 }

//             } catch (error: any) {
//                 console.log(ansiColors.red(`✗ Linked content ${itemName} failed: ${error.message}`));
//                 skippedContentItems[contentItem.contentID] = itemName;
//                 failedItems++;
//                 if (onProgress) onProgress(totalProcessed, linkedContentItems.length, itemName, 'error');
//                 continue;
//             }
//         }

//         // Remove items processed in this pass
//         remainingContentItems = remainingContentItems.filter(item => 
//             !processedInThisPass.includes(item.contentID) && 
//             !skippedContentItems[item.contentID]
//         );
        
//         const afterCount = remainingContentItems.length;
//         const progressMade = beforeCount > afterCount;

//         if (!progressMade && remainingContentItems.length > 0 && attemptCount >= maxAttempts) {
//             console.log(ansiColors.yellow(`⚠️ Maximum attempts (${maxAttempts}) reached for linked content. ${remainingContentItems.length} items may have unresolved dependencies.`));
            
//             // Mark remaining items as failed
//             remainingContentItems.forEach(item => {
//                 if (!skippedContentItems[item.contentID]) {
//                     skippedContentItems[item.contentID] = 'Unresolved dependencies after max attempts';
//                     failedItems++;
//                 }
//             });
//             break;
//         }

//     } while (remainingContentItems.length > 0 && attemptCount < maxAttempts);

//     console.log(ansiColors.cyan(`[Content Pusher] Batch-optimized linked content complete: ${successfulItems} success, ${failedItems} failed after ${attemptCount} passes`));
//     return { successfulItems, failedItems, publishableIds };
// }

/**
 * Check if all content dependencies are resolved for a content item
 */
function areContentDependenciesResolved(
    contentItem: mgmtApi.ContentItem,
    referenceMapper: ReferenceMapper,
    models: mgmtApi.Model[]
): boolean {
    if (!contentItem.fields) {
        return true; // No fields, no dependencies
    }

    // Find the model for this content item
    const model = models.find(m => m.referenceName === contentItem.properties?.definitionName);
    if (!model) {
        return true; // No model, assume resolved
    }

    // Check each field for content references
    return !hasUnresolvedContentReferences(contentItem.fields, referenceMapper);
}

/**
 * Recursively check for unresolved content references
 */
function hasUnresolvedContentReferences(obj: any, referenceMapper: ReferenceMapper): boolean {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }

    if (Array.isArray(obj)) {
        return obj.some(item => hasUnresolvedContentReferences(item, referenceMapper));
    }

    for (const [key, value] of Object.entries(obj)) {
        // Check for content reference patterns
        if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
            const mappedId = referenceMapper.getMappedId('content', value);
            if (!mappedId) {
                return true; // Unresolved content reference
            }
        }

        // Check for comma-separated content IDs in sortids fields
        if (key === 'sortids' && typeof value === 'string') {
            const contentIds = value.split(',').filter(id => id.trim());
            for (const contentIdStr of contentIds) {
                const contentId = parseInt(contentIdStr.trim());
                if (!isNaN(contentId)) {
                    const mappedId = referenceMapper.getMappedId('content', contentId);
                    if (!mappedId) {
                        return true; // Unresolved content reference
                    }
                }
            }
        }

        // Recursive check for nested objects
        if (hasUnresolvedContentReferences(value, referenceMapper)) {
            return true;
        }
    }

    return false;
}

/**
 * Extract content ID from API response (handles various response formats)
 * Enhanced with better logging and format detection
 */
function extractContentId(targetContentId: any): number {
    if (typeof targetContentId === 'number') {
        return targetContentId;
    } else if (typeof targetContentId === 'object' && Array.isArray(targetContentId)) {
        const firstElement = targetContentId[0];
        return firstElement || -1;
    } else if (typeof targetContentId === 'object' && targetContentId !== null) {
        // Check various object response formats
        if ('items' in targetContentId && Array.isArray(targetContentId.items) && targetContentId.items[0]) {
            const itemID = targetContentId.items[0].itemID;
            return itemID || -1;
        }
        
        // Check for direct contentID field
        if ('contentID' in targetContentId) {
            return targetContentId.contentID || -1;
        }
        
        // Check for batch response format
        if ('batchID' in targetContentId) {
            if (targetContentId.batchState === 3 && targetContentId.items && Array.isArray(targetContentId.items)) {
                const contentItem = targetContentId.items.find((item: any) => item.itemType === 1);
                if (contentItem && contentItem.itemID > 0 && !contentItem.itemNull) {
                    return contentItem.itemID;
                }
            }
            // Log detailed info only for batch failures
            console.log(`[API Response] ✗ Batch response failed: ${JSON.stringify(targetContentId)}`);
            return -1;
        }
        
        // Log detailed info only for unknown formats (failures)
        console.log(`[API Response] ✗ Unknown object format:`, Object.keys(targetContentId), targetContentId);
        return -1;
    } else {
        // Log detailed info only for unexpected types (failures)  
        console.log(`[API Response] ✗ Unexpected response type: ${typeof targetContentId}, Value:`, targetContentId);
        return -1;
    }
}

/**
 * Main content pusher function using legacy pattern
 */
export async function pushContent(
    sourceData: any,
    referenceMapper: ReferenceMapper,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successful: number, failed: number, skipped: number, publishableIds: number[] }> {

    // Extract data from sourceData - unified parameter pattern
    const contentItems: mgmtApi.ContentItem[] = sourceData.content || [];
    const models: mgmtApi.Model[] = sourceData.models || [];

    if (!contentItems || contentItems.length === 0) {
        console.log('No content items found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0, publishableIds: [] };
    }

    // Get state values instead of prop drilling
    const { targetGuid, locale, overwrite, sourceGuid } = state;
    const apiClient = state.apiClient;

    // Use passed models or load from filesystem as fallback
    let resolvedModels: mgmtApi.Model[] = models || [];
    
    if (!resolvedModels || resolvedModels.length === 0) {
        // console.log(ansiColors.cyan(`[Content Pusher] Loading models for content classification...`));
        
        try {
            // Import the model getter and fileOperations
            const { getModelsFromFileSystem } = await import('../getters/filesystem');
                          const { fileOperations } = await import('../../core');
            
            // Use source GUID from state instead of complex lookup logic
            
            // Create fileOperations instance for the source data
            const fileOps = new fileOperations('agility-files', sourceGuid, locale, true);
            
            resolvedModels = getModelsFromFileSystem(fileOps);
            
            // console.log(ansiColors.cyan(`[Content Pusher] Loaded ${resolvedModels.length} models for classification`));
            
        } catch (error: any) {
            console.warn(ansiColors.yellow(`[Content Pusher] Could not load models: ${error.message}. Using simplified classification.`));
            // Continue with empty models array - classification will treat all content as normal
        }
    } else {
        // console.log(ansiColors.cyan(`[Content Pusher] Using ${resolvedModels.length} models passed from caller`));
    }

    const originalItemCount = contentItems.length;
    let overallSuccessful = 0;
    let overallFailed = 0;
    let overallSkipped = 0;
    let overallStatus: 'success' | 'error' = 'success';
    const publishableIds: number[] = []; // Collect target content IDs for auto-publishing

    // Initialize default asset container URL
    const defaultTargetAssetContainerOriginUrl = await getDefaultAssetContainerUrl(apiClient, targetGuid);

   
    // BULK MAPPING FILTER: Check for existing mappings unless overwrite is enabled
    const { bulkFilterByExistingMappings } = await import('../shared/bulk-mapping-filter');
    const filterResult = await bulkFilterByExistingMappings(contentItems, referenceMapper, overwrite);
    
    // console.log(ansiColors.cyan(
    //     `[Content Pusher] Processing ${filterResult.unmappedItems.length}/${filterResult.mappingStats.total} items ` +
    //     `(${filterResult.mappingStats.percentMapped}% already mapped, overwrite: ${overwrite})`
    // ));
    
    if (!overwrite && filterResult.alreadyMapped.length > 0) {
        console.log(ansiColors.gray.italic(`Skipping ${filterResult.alreadyMapped.length} existing content items (use --overwrite to process all)`));
    }

    // Use filtered content items for processing
    const contentItemsToProcess = filterResult.unmappedItems;
    const totalItemCount = contentItemsToProcess.length;
    // Add filtered items to skipped count
    overallSkipped += filterResult.alreadyMapped.length;
    
    // console.log(ansiColors.cyan(`[Content Pusher] Processing ${totalItemCount} content items (filtered ${originalItemCount - totalItemCount} i18 items)`));

    // Step 1: Classify content into normal vs linked (using filtered items)
    const classifier = new ContentClassifier();
    const classification = await classifier.classifyContent(contentItemsToProcess, resolvedModels);
    
    // console.log(ansiColors.cyan(`[Content Pusher] ${classifier.getClassificationStats(classification)}`));

    // Step 2: Process normal content items first (no dependencies)
    if (classification.normalContentItems.length > 0) {
        const normalProgressCallback = (processed: number, total: number, item: string, status: 'success' | 'error') => {
            if (onProgress) onProgress(processed, totalItemCount, status);
        };

        const normalResult = await pushNormalContentItems(
            classification.normalContentItems,
            targetGuid,
            locale,
            apiClient,
            referenceMapper,
            resolvedModels,
            defaultTargetAssetContainerOriginUrl || '',
            normalProgressCallback
        );

        overallSuccessful += normalResult.successfulItems;
        overallFailed += normalResult.failedItems;
        publishableIds.push(...normalResult.publishableIds); // Collect target IDs for auto-publishing
        
        if (normalResult.failedItems > 0) {
            overallStatus = 'error';
        }
    }

    // Step 3: Process linked content items (with dependencies)
    if (classification.linkedContentItems.length > 0) {
        const linkedProgressCallback = (processed: number, total: number, item: string, status: 'success' | 'error') => {
            const totalProcessedSoFar = classification.normalContentItems.length + processed;
            if (onProgress) onProgress(totalProcessedSoFar, totalItemCount, status);
        };

        const linkedResult = await processLinkedContentIndividually(
            classification.linkedContentItems,
            targetGuid,
            locale,
            apiClient,
            referenceMapper,
            resolvedModels,
            defaultTargetAssetContainerOriginUrl || '',
            linkedProgressCallback
        );

        overallSuccessful += linkedResult.successfulItems;
        overallFailed += linkedResult.failedItems;
        publishableIds.push(...linkedResult.publishableIds); // Collect target IDs for auto-publishing
        
        if (linkedResult.failedItems > 0) {
            overallStatus = 'error';
        }
    }

    // console.log(ansiColors.yellow(`Processed ${overallSuccessful}/${totalItemCount} content items (${overallFailed} failed, ${overallSkipped} skipped)`));
    return { status: overallStatus, successful: overallSuccessful, failed: overallFailed, skipped: overallSkipped, publishableIds };
}


