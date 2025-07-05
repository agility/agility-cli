import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";

export async function findContentInTargetInstance(
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
