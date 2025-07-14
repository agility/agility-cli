import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";

export async function findContentInTargetInstance(
    sourceContent: mgmtApi.ContentItem,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    locale: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): Promise<{ content: mgmtApi.ContentItem | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean }> {
    const state = getState();
    const overwrite = state.overwrite;
    let existsInTarget = false;

    // STEP 1: Check for existing mapping of source content to target content
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.ContentItem>("content", "contentID", sourceContent.contentID);
    let targetContentFromMapping: mgmtApi.ContentItem | null = existingMapping?.target || null;

    // STEP 2: Find target instance data (local file data) for this content
    const targetInstanceData = targetData.content?.find((c: any) => {
        // Try multiple matching strategies for target data
        if (targetContentFromMapping) {
            // If we have a mapping, match by target content properties
            return (
                c.contentID === targetContentFromMapping.contentID ||
                c.properties?.referenceName === targetContentFromMapping.properties?.referenceName
            );
        } else {
            // If no mapping, match by source content properties
            return c.properties?.referenceName === sourceContent.properties?.referenceName;
        }
    });

    if (targetInstanceData) {
        existsInTarget = true;
    }

    // STEP 3: Decision logic based on mapping and target data
    let shouldUpdate = false;
    let shouldCreate = false;
    let shouldSkip = false;
    let finalTargetContent: mgmtApi.ContentItem | null = null;

    if (targetInstanceData) {
        // Target content exists in target instance
        finalTargetContent = targetInstanceData;
        shouldCreate = false;

        if (targetContentFromMapping) {
            // Both mapping and target data exist - compare versions for update decision
            const mappingVersionID = targetContentFromMapping.properties?.versionID || 0;
            const targetDataVersionID = targetInstanceData.properties?.versionID || 0;
            
            // Also compare modified dates as secondary check
            const mappingModified = new Date(targetContentFromMapping.properties?.modified || 0);
            const targetDataModified = new Date(targetInstanceData.properties?.modified || 0);

            // Use versionID as primary comparison, modified date as secondary
            if (targetDataVersionID > mappingVersionID || 
                (targetDataVersionID === mappingVersionID && targetDataModified > mappingModified)) {
                shouldUpdate = true;
                shouldSkip = false;
            } else {
                shouldUpdate = false;
                shouldSkip = true;
            }
        } else {
            // Target data exists but no mapping - this is existing content, add mapping
            shouldUpdate = false;
            shouldSkip = true;
        }

        // REMOVED: Do not update mapping here - let the pusher handle it after successful operations
    } else {
        // No target instance data found - content doesn't exist in target
        shouldCreate = true;
        shouldUpdate = false;
        shouldSkip = false;
        finalTargetContent = null;
        
        const contentName = sourceContent.properties?.referenceName || `ID:${sourceContent.contentID}`;
        // console.log(ansiColors.blue(`Content ${contentName} not found in target - should create`));
    }

    // STEP 5: Handle overwrite flag
    if (overwrite) {
        if (existsInTarget) {
            shouldUpdate = true;
            shouldCreate = false;
            shouldSkip = false;
        } else {
            shouldCreate = true;
            shouldUpdate = false;
            shouldSkip = false;
        }
    }

    return {
        content: finalTargetContent || sourceContent, // If no target content found, use source content as fallback
        shouldUpdate: shouldUpdate,
        shouldCreate: shouldCreate,
        shouldSkip: shouldSkip,
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
    referenceMapper: ReferenceMapper
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
