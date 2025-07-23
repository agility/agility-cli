import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import * as mgmtApi from '@agility/management-sdk';
// Removed finder imports - using mapper directly
import ansiColors from "ansi-colors";
import {
    ContentClassifier,
    type ContentClassification,
    ContentFieldMapper,
    GuidEntities
} from '../shared';
// Removed ContentBatchProcessor import - individual pusher only handles individual processing
import { state, getState } from '../../core/state';
import { ChangeDeltaFileWorker } from "lib/shared/change-delta-file-worker";
import { MappingLookupResult } from "types/referenceMapperV2";
import { ContentItemMapper, ContentItemMapping } from "lib/mappers/content-item-mapper";
import { AssetMapper } from "lib/mappers/asset-mapper";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContainerMapper } from "lib/mappers/container-mapper";


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
    referenceMapper: ContentItemMapper,
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

    // instantiate asset mapper with source and target GUIDs so it can be used in field mapping
    const assetMapper = new AssetMapper(state.sourceGuid[0], state.targetGuid[0]);

    // Map the content item fields using enhanced reference transformation
    const mappingResult = fieldMapper.mapContentFields(contentItem.fields, {
        referenceMapper,
        assetMapper,
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
    referenceMapper: ContentItemMapper,
    models: mgmtApi.Model[],
    defaultAssetUrl: string,
    onProgress?: (processed: number, total: number, item: string, status: 'success' | 'error') => void
): Promise<{ successfulItems: number, failedItems: number, publishableIds: number[] }> {

    let successfulItems = 0;
    let failedItems = 0;

    console.log(ansiColors.cyan(`[Content Pusher] Processing ${normalContentItems.length} normal content items individually`));

    const { GuidDataLoader } = await import('./guid-data-loader');
    const targetDataLoader = new GuidDataLoader(targetGuid);
    const { guidEntities: targetData, locales: targetLocales } = await targetDataLoader.loadGuidEntitiesForAllLocales();


    console.log(ansiColors.bgCyan(`targetContent: ${JSON.stringify(targetData.content)}`))
    console.log(ansiColors.bgCyan(`normalContentItems : ${JSON.stringify(normalContentItems)}`))

    for (let i = 0; i < normalContentItems.length; i++) {
        const contentItem = normalContentItems[i];
        const itemName = contentItem.properties.referenceName || 'Unknown';

        try {
            // Check if content item already exists in target using new finder pattern



            const findResult = await findContentInTargetInstance(contentItem, apiClient, targetGuid, locale, targetData, referenceMapper);
            const { content: existingContentItem, shouldUpdate, shouldCreate, shouldSkip, isConflict } = findResult;

            if (shouldSkip) {
                // Skip if already exists and up to date
                console.log(ansiColors.gray(`[Content Pusher] ↷ Skipping ${itemName}: already exists and up to date`));
                continue;
            } else if (isConflict) {
                // Handle conflict case
                console.log(ansiColors.yellow(`[Content Pusher] ⚠️ Conflict detected. ${findResult.decision.reason}`));
                continue;
            } else if (!shouldCreate && !shouldUpdate) {
                // This shouldn't happen, but handle it gracefully
                console.log(ansiColors.gray(`[Content Pusher] ↷ Skipping ${itemName}: no action needed`));
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
                // Create full target content item object from API response
                const targetContentItem = {
                    ...mappedItem,
                    contentID: newContentId,
                    properties: {
                        ...mappedItem.properties,
                        referenceName: itemName,
                        // Use current timestamp as modified date since we just created/updated it
                        modified: new Date().toISOString()
                    }
                };

                // Add mapping to reference mapper with full target object
                referenceMapper.addMapping(contentItem, targetContentItem);

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
    referenceMapper: ContentItemMapper,
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
    referenceMapper: ContentItemMapper,
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

    if (linkedContentItems.length > 0) {
        console.log(ansiColors.cyan(`[Content Pusher] Processing ${linkedContentItems.length} linked content items individually with dependency resolution`));
    }

    //get the other mappers
    const modelMapper = new ModelMapper(state.sourceGuid[0], state.targetGuid[0]);
    const containerMapper = new ContainerMapper(state.sourceGuid[0], state.targetGuid[0]);

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

                // Find target model using model mapper
                const targetModelId = modelMapper.getModelMappingByID(sourceModel.id, "source");
                if (!targetModelId) {
                    skippedContentItems[contentItem.contentID] = `Target model mapping not found: ${sourceModel.referenceName} (ID: ${sourceModel.id})`;
                    console.log(ansiColors.red(`✗ Linked content ${itemName} failed - target model mapping not found: ${sourceModel.referenceName}`));
                    failedItems++;
                    continue;
                }

                // Find container

                const containerMapping = containerMapper.getContainerMappingByReferenceName(contentItem.properties.referenceName, "source");
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
                const existingContentItem = await findContentInTargetInstanceLegacy(contentItem, apiClient, targetGuid, locale, referenceMapper);

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
                    // Create full target content item object from API response
                    const targetContentItem = {
                        ...mappedItem,
                        contentID: newContentId,
                        properties: {
                            ...mappedItem.properties,
                            referenceName: itemName,
                            // Use current timestamp as modified date since we just created/updated it
                            modified: new Date().toISOString()
                        }
                    };

                    // Add mapping to reference mapper with full target object
                    referenceMapper.addMapping('content', contentItem, targetContentItem);

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
 * Check if all content dependencies are resolved for a content item
 */
/**
 * Simple change detection for content items
 */
interface ChangeDetection {
    entity: any;
    shouldUpdate: boolean;
    shouldCreate: boolean;
    shouldSkip: boolean;
    isConflict: boolean;
    reason: string;
}

function changeDetection(
    sourceEntity: mgmtApi.ContentItem,
    targetEntity: mgmtApi.ContentItem | null,
    mapping: ContentItemMapping,
): ChangeDetection {

    if (!mapping && !targetEntity) {
        //if we have no target content and no mapping
        return {
            entity: null,
            shouldUpdate: false,
            shouldCreate: true,
            shouldSkip: false,
            isConflict: false,
            reason: 'Entity does not exist in target'
        };
    }

    // Check if update is needed based on version or modification date
    const sourceVersion = sourceEntity.properties?.versionID;
    const targetVersion = targetEntity.properties?.versionID;

    const mappedSourceVersion = (mapping?.sourceVersionID || 0) as number;
    const mappedTargetVersion = (mapping?.targetVersionID || 0) as number;

    if (sourceVersion && targetVersion)
        //both the source and the target exist


        if (sourceVersion > mappedSourceVersion && targetVersion > mappedTargetVersion) {
            //CONFLICT DETECTION
            // Source version is newer than mapped source version
            // and target version is newer than mapped target version

            //build the url to the source and target entity
            //TODO: if there are multiple guids we need to handle that
            const sourceUrl = `https://app.agilitycms.com/${state.sourceGuid[0]}/${state.locale}/content/listitem-${sourceEntity.contentID}`;
            const targetUrl = `https://app.agilitycms.com/${state.targetGuid[0]}/${state.locale}/content/listitem-${targetEntity.contentID}`;

            return {
                entity: targetEntity,
                shouldUpdate: false,
                shouldCreate: false,
                shouldSkip: false,
                isConflict: true,
                reason: `Both source and target versions have been updated. Please resolve manually - source:${sourceUrl} <-> target:${targetUrl}.`
            };

        }

    if (sourceVersion > mappedSourceVersion && targetVersion <= mappedTargetVersion) {
        //SOURCE UPDATE ONLY
        // Source version is newer the mapped source version
        // and target version is NOT newer than mapped target version
        return {
            entity: targetEntity,
            shouldUpdate: true,
            shouldCreate: false,
            shouldSkip: false,
            isConflict: false,
            reason: 'Source version is newer.'
        };
    }


    return {
        entity: targetEntity,
        shouldUpdate: false,
        shouldCreate: false,
        shouldSkip: true,
        isConflict: false,
        // No update needed, target is up to date
        reason: 'Entity exists and is up to date'
    };
}

/**
 * Enhanced content item finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */
export function findContentInTargetInstance(
    sourceContent: mgmtApi.ContentItem,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    locale: string,
    targetData: GuidEntities,
    referenceMapper: ContentItemMapper
): {
    content: mgmtApi.ContentItem | null;
    shouldUpdate: boolean;
    shouldCreate: boolean;
    shouldSkip: boolean;
    isConflict: boolean;
    decision?: ChangeDetection
} {
    const state = getState();

    // STEP 1: Find existing mapping

    //GET FROM SOURCE MAPPING
    const mappedEntity = referenceMapper.getContentItemMappingByContentID(sourceContent.contentID, "source");

    let targetContent: mgmtApi.ContentItem | null = null;

    if (mappedEntity) {

        // STEP 2: Find target content item using mapping
        targetContent = targetData.content?.find((c: any) => {
            // Check if content ID matches mapped entity's target ID (entityB)
            if (c.contentID === mappedEntity.targetContentID) {
                return c;
            }
            return null;
        }) as mgmtApi.ContentItem | null;
    }

    // STEP 3: Use change detection for conflict resolution
    const decision = changeDetection(
        sourceContent,
        targetContent,
        mappedEntity
    );

    return {
        content: decision.entity || null,
        shouldUpdate: decision.shouldUpdate,
        shouldCreate: decision.shouldCreate,
        shouldSkip: decision.shouldSkip,
        isConflict: decision.isConflict,
        decision: decision
    };
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use findContentInTargetInstance with targetData parameter instead
 */
export async function findContentInTargetInstanceLegacy(
    contentItem: mgmtApi.ContentItem,
    apiClient: mgmtApi.ApiClient,
    guid: string,
    locale: string,
    referenceMapper: ReferenceMapperV2
): Promise<mgmtApi.ContentItem | null> {
    try {
        // First check the reference mapper for content item with the same content ID
        const targetMapping = referenceMapper.getMapping('content', contentItem.contentID);

        if (targetMapping) {
            return targetMapping as mgmtApi.ContentItem;
        }

        // FIXED: Search by reference name in target instance, not source content ID
        const referenceName = contentItem.properties?.referenceName;
        if (!referenceName) {
            // No reference name to search with
            return null;
        }

        try {
            // Get all containers and search through their content lists
            const containers = await apiClient.containerMethods.getContainerList(guid);

            for (const container of containers) {
                try {
                    const contentList = await apiClient.contentMethods.getContentList(container.referenceName, guid, locale, null);
                    if (contentList && contentList.items) {
                        const existingContent = contentList.items.find(item =>
                            item.properties?.referenceName === referenceName
                        );

                        if (existingContent) {
                            console.log(`✅ Found existing content in target: ${referenceName} (ID: ${existingContent.contentID}) in container: ${container.referenceName}`);
                            return existingContent;
                        }
                    }
                } catch (containerError) {
                    // Continue to next container if this one fails
                    continue;
                }
            }

            return null; // Not found in any container
        } catch (apiError) {
            // If API call fails, assume content doesn't exist
            return null;
        }

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return null;
        }
        throw error;
    }
}

export function areContentDependenciesResolved(
    contentItem: mgmtApi.ContentItem,
    referenceMapper: ContentItemMapper,
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
function hasUnresolvedContentReferences(obj: any, referenceMapper: ContentItemMapper): boolean {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }

    if (Array.isArray(obj)) {
        return obj.some(item => hasUnresolvedContentReferences(item, referenceMapper));
    }

    for (const [key, value] of Object.entries(obj)) {
        // Check for content reference patterns
        if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
            const mappedId = referenceMapper.getContentItemMappingByContentID(value, 'source');
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
                    const mappedId = referenceMapper.getContentItemMappingByContentID(contentId, 'source');
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
    targetData: any,
    referenceMapper: ReferenceMapperV2,
    changeDeltaWorker: ChangeDeltaFileWorker,
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
    const { getApiClient } = await import('../../core/state');
    const apiClient = getApiClient();

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
            const fileOps = new fileOperations(sourceGuid[0], locale[0]);

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
    const defaultTargetAssetContainerOriginUrl = await getDefaultAssetContainerUrl(apiClient, targetGuid[0]);


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
            targetGuid[0],
            locale[0],
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
            targetGuid[0],
            locale[0],
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

/**
 * Smart content pusher that chooses between individual vs batch processing
 * Moved from orchestrate-pushers.ts for better separation of concerns
 */
export async function pushContentSmart(
    sourceData: any,
    targetData: any,
): Promise<any> {
    if (state.noBatch) {
        // Use individual pusher when --no-batch flag is enabled
        // return await pushContent(sourceData, targetData, referenceMapper, changeDeltaWorker);
    } else {
        // Use batch pusher for better performance (default behavior)
        const { ContentBatchProcessor } = await import('./content-item-batch-pusher');


        const { sourceGuid, targetGuid, locale } = state;

        const referenceMapper = new ContentItemMapper(sourceGuid[0], targetGuid[0]);
        const contentItems = sourceData.content || [];

        if (contentItems.length === 0) {
            return { status: "success" as const, successful: 0, failed: 0, skipped: 0, publishableIds: [] };
        }

        // Separate content items into normal and linked batches
        const normalContentItems: any[] = [];
        const linkedContentItems: any[] = [];

        for (const contentItem of contentItems) {
            // Find source model for this content item
            let sourceModel = sourceData.models?.find(
                (m: any) => m.referenceName === contentItem.properties.definitionName
            );
            if (!sourceModel && sourceData.models) {
                sourceModel = sourceData.models.find(
                    (m: any) => m.referenceName.toLowerCase() === contentItem.properties.definitionName.toLowerCase()
                );
            }

            if (!sourceModel) {
                // No model found - treat as linked content for dependency resolution
                linkedContentItems.push(contentItem);
                continue;
            }

            // Check if content has unresolved dependencies
            if (areContentDependenciesResolved(contentItem, referenceMapper, [sourceModel])) {
                normalContentItems.push(contentItem);
            } else {
                linkedContentItems.push(contentItem);
            }
        }

        let totalSuccessful = 0;
        let totalFailed = 0;
        let totalSkipped = 0;
        const allPublishableIds: number[] = [];

        try {
            // Import getApiClient for both batch configurations
            const { getApiClient } = await import('../../core/state');

            // Process normal content items first (no dependencies)
            if (normalContentItems.length > 0) {
                const normalBatchConfig = {
                    apiClient: getApiClient(),
                    targetGuid: state.targetGuid[0],
                    locale: state.locale[0],
                    referenceMapper,
                    batchSize: 250,
                    useContentFieldMapper: true,
                    models: sourceData.models,
                    defaultAssetUrl: "",
                };

                const filteredNormalContentItems = await filterContentItemsForProcessing(
                    normalContentItems,
                    getApiClient(),
                    state.targetGuid[0],
                    state.locale[0],
                    referenceMapper,
                    targetData,
                    "normal"
                );
                const normalBatchProcessor = new ContentBatchProcessor(normalBatchConfig);
                const normalResult = await normalBatchProcessor.processBatches(
                    filteredNormalContentItems.itemsToCreate as any,
                    undefined,
                    "Normal Content"
                );

                totalSuccessful += normalResult.successCount;
                totalFailed += normalResult.failureCount;
                totalSkipped += filteredNormalContentItems.skippedCount;
                totalSkipped += normalResult.skippedCount;
                allPublishableIds.push(...normalResult.publishableIds);
            }

            // Process linked content items second (with dependencies)
            if (linkedContentItems.length > 0) {
                const linkedBatchConfig = {
                    apiClient: getApiClient(),
                    targetGuid: state.targetGuid[0],
                    locale: state.locale[0],
                    referenceMapper,
                    batchSize: 100, // Smaller batches for linked content due to complexity
                    useContentFieldMapper: true,
                    models: sourceData.models,
                    defaultAssetUrl: "",
                };

                const filteredLinkedContentItems = await filterContentItemsForProcessing(
                    linkedContentItems,
                    getApiClient(),
                    state.targetGuid[0],
                    state.locale[0],
                    referenceMapper,
                    targetData,
                    "linked"
                );
                const linkedBatchProcessor = new ContentBatchProcessor(linkedBatchConfig);
                const linkedResult = await linkedBatchProcessor.processBatches(
                    filteredLinkedContentItems.itemsToCreate,
                    undefined,
                    "Linked Content"
                );

                totalSuccessful += linkedResult.successCount;
                totalFailed += linkedResult.failureCount;
                totalSkipped += filteredLinkedContentItems.skippedCount;
                totalSkipped += linkedResult.skippedCount;
                allPublishableIds.push(...linkedResult.publishableIds);
            }

            // Convert batch result to expected PusherResult format
            return {
                status: (totalFailed > 0 ? "error" : "success") as "success" | "error",
                successful: totalSuccessful,
                failed: totalFailed,
                skipped: totalSkipped,
                publishableIds: allPublishableIds,
            };
        } catch (batchError: any) {
            console.error(ansiColors.red(`❌ Batch processing failed: ${batchError.message}`));
            console.log(ansiColors.yellow(`🔄 Falling back to individual processing...`));
            return await pushContent(sourceData, targetData, referenceMapper, changeDeltaWorker);
        }
    }
}

/**
 * Filter content items for processing
 * Moved from orchestrate-pushers.ts for better separation of concerns
 */
export interface ContentFilterResult {
    itemsToCreate: any[];
    itemsToUpdate: any[];
    itemsToSkip: any[];
    skippedCount: number;
}

export async function filterContentItemsForProcessing(
    contentItems: any[],
    apiClient: any,
    targetGuid: string,
    locale: string,
    referenceMapper: ContentItemMapper,
    targetData?: any,
    type?: "normal" | "linked"
): Promise<ContentFilterResult> {
    const itemsToCreate: any[] = [];
    const itemsToUpdate: any[] = [];
    const itemsToSkip: any[] = [];

    for (const contentItem of contentItems) {
        const itemName = contentItem.properties.referenceName || "Unknown";

        try {
            const findResult = findContentInTargetInstance(
                contentItem,
                apiClient,
                targetGuid,
                locale,
                targetData,
                referenceMapper
            );

            const { content, shouldUpdate, shouldCreate, shouldSkip } = findResult;

            if (shouldCreate) {
                // Content doesn't exist - include it for creation
                itemsToCreate.push(contentItem);
            } else if (shouldUpdate) {
                // Content exists but needs updating
                itemsToUpdate.push(contentItem);
                console.log(
                    `✓ Content ${ansiColors.cyan.underline(itemName)} vID:${ansiColors.bold.yellow(
                        "needs update"
                    )} vID:${ansiColors.bold.green(content?.properties?.versionID.toString())} → ${ansiColors.bold.green(
                        contentItem.properties?.versionID.toString()
                    )} - ${ansiColors.green(targetGuid)}: ID:${content?.contentID}`
                );
            } else if (shouldSkip) {
                // Content exists and is up to date - skip
                console.log(
                    `✓ Content ${ansiColors.cyan.underline(itemName)} ${ansiColors.bold.gray(
                        "up to date, skipping"
                    )}`
                );
                itemsToSkip.push(contentItem);
            }
        } catch (error: any) {
            // If we can't check, err on the side of processing it
            console.warn(`⚠️ Could not check if content ${itemName} exists: ${error.message} - will process`);
            itemsToCreate.push(contentItem);
        }
    }

    return {
        itemsToCreate,
        itemsToUpdate,
        itemsToSkip,
        skippedCount: itemsToSkip.length,
    };
}


