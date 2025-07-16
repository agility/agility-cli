import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";
import { FinderDecisionEngine, FinderDecision } from "../shared/target-safety-detector";

/**
 * Enhanced content item finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export function findContentInTargetInstance(
    sourceContent: mgmtApi.ContentItem,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    locale: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): { content: mgmtApi.ContentItem | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: FinderDecision } {
    const state = getState();

    // STEP 1: Find existing mapping
    const existingMapping = referenceMapper.getMapping<mgmtApi.ContentItem>("content", sourceContent.contentID);
    let targetContentFromMapping: mgmtApi.ContentItem | null = existingMapping || null;
    
    // STEP 2: Find target instance data
    const targetInstanceData = targetData.content?.find((c: any) => {
        if(c.contentID === targetContentFromMapping?.contentID){
            return c;
        }
        return null;
    });

    // STEP 3: Use FinderDecisionEngine for proper conflict resolution
    const decision = FinderDecisionEngine.makeDecision(
        'content-item',
        sourceContent.contentID,
        sourceContent.properties?.referenceName || `Content-${sourceContent.contentID}`,
        sourceContent,
        targetContentFromMapping,
        targetInstanceData
    );

    return {
        content: decision.entity || null,
        shouldUpdate: decision.shouldUpdate,
        shouldCreate: decision.shouldCreate,
        shouldSkip: decision.shouldSkip,
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
