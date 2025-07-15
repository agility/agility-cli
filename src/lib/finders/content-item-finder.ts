import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";

export function findContentInTargetInstance(
    sourceContent: mgmtApi.ContentItem,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    locale: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): { content: mgmtApi.ContentItem | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean } {
    const state = getState();
    const overwrite = state.overwrite;
    let existsInTarget = false;

    // STEP 1: Check for existing mapping of source content to target content
    const existingMapping = referenceMapper.getMapping<mgmtApi.ContentItem>("content", sourceContent.contentID);
    let targetContentFromMapping: mgmtApi.ContentItem | null = existingMapping || null;
    // STEP 2: Find target instance data (local file data) for this content
    const targetInstanceData = targetData.content?.find((c: any) => {
        if(c.contentID === targetContentFromMapping?.contentID){
            return c;
        }
        return null;
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
            
            // if the target instance data versionID is greater than the mapping versionID
            // this means a user has updated the content in the target instance
            // we need to WARN the user that the content has been updated in the target instance
            // and skip the create





            
            if (targetDataVersionID !== mappingVersionID) {
                shouldCreate = true;
                shouldUpdate = false;
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
        const contentName = sourceContent.properties?.referenceName || `ID:${sourceContent.contentID}`;
        
        if (targetContentFromMapping) {
     

            shouldCreate = true;
            shouldUpdate = false;
            shouldSkip = false;
            finalTargetContent = targetContentFromMapping;
        } else {
            // No mapping and no target data - completely new content
            shouldCreate = true;
            shouldUpdate = false;
            shouldSkip = false;
            finalTargetContent = null;
        }
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
        content: finalTargetContent || null, // If no target content found, use source content as fallback
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
