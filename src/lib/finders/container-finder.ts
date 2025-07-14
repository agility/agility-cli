import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from 'ansi-colors';
import { getState } from "../../core/state";

/**
 * Enhanced container finder following the asset-finder pattern
 * Returns shouldUpdate/shouldCreate/shouldSkip decisions based on lastModifiedDate comparison
 */
export async function findContainerInTargetInstanceEnhanced(
    sourceContainer: mgmtApi.Container,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): Promise<{ container: mgmtApi.Container | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean }> {
    const state = getState();
    const overwrite = state.overwrite;
    let existsInTarget = false;


    // STEP 1: Check for existing mapping of source container to target container
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Container>("container", "referenceName", sourceContainer.referenceName);
    let targetContainerFromMapping: mgmtApi.Container | null = existingMapping?.target || null;

    // console.log(ansiColors.magenta(`existingMapping: ${JSON.stringify(existingMapping)}`));
    // console.log(ansiColors.magenta(`sourceContainer: ${JSON.stringify(sourceContainer)}`));

    // console.log(ansiColors.green(`targetContainerFromMapping: ${targetContainerFromMapping}`));
    // console.log(ansiColors.green(`sourceContainer: ${sourceContainer.referenceName}`));

    // STEP 2: Find target instance data (local file data) for this container
    const targetInstanceData = targetData.containers?.find((c: any) => {
        // Try multiple matching strategies for target data
        if (targetContainerFromMapping) {
            // If we have a mapping, match by target container properties
            return (
                c.referenceName === targetContainerFromMapping.referenceName ||
                c.contentViewID === targetContainerFromMapping.contentViewID
            );
        } else {
            // If no mapping, match by source container properties
            return c.referenceName === sourceContainer.referenceName;
        }
    });

    // console.log(ansiColors.magenta(`targetInstanceData: ${JSON.stringify(targetInstanceData)}`));

    if (targetInstanceData) {
        existsInTarget = true;
    }

    // STEP 3: Decision logic based on mapping and target data
    let shouldUpdate = false;
    let shouldCreate = false;
    let shouldSkip = false;
    let finalTargetContainer: mgmtApi.Container | null = null;

    if (targetInstanceData) {
        // Target container exists in target instance
        finalTargetContainer = targetInstanceData;
        shouldCreate = false;

        if (targetContainerFromMapping) {
            // Both mapping and target data exist - compare dates for update decision
            const mappingDate = new Date(targetContainerFromMapping.lastModifiedDate || 0);
            const targetDataDate = new Date(targetInstanceData.lastModifiedDate || 0);

            if (targetDataDate > mappingDate) {
                shouldUpdate = true;
                shouldSkip = false;
            } else {
                shouldUpdate = false;
                shouldSkip = true;
            }
        } else {
            // Target data exists but no mapping - this is an existing container, add mapping
            shouldUpdate = false;
            shouldSkip = true;
        }

        // REMOVED: Do not update mapping here - let the pusher handle it after successful operations
    } else {
        // No target instance data found - container doesn't exist in target
        shouldCreate = true;
        shouldUpdate = false;
        shouldSkip = false;
        finalTargetContainer = null;
        // console.log(ansiColors.blue(`Container ${sourceContainer.referenceName} not found in target - should create`));
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
        container: finalTargetContainer || sourceContainer, // If no target container found, use source container as fallback
        shouldUpdate: shouldUpdate,
        shouldCreate: shouldCreate,
        shouldSkip: shouldSkip,
    };
}

// Function overloads to handle both Container object and string referenceName
export async function findContainerInTargetInstance(
    container: mgmtApi.Container, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null>;

export async function findContainerInTargetInstance(
    referenceName: string, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null>;

export async function findContainerInTargetInstance(
    containerOrReferenceName: mgmtApi.Container | string, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null> {
    try {
        // Extract referenceName from either Container object or string
        const referenceName = typeof containerOrReferenceName === 'string' 
            ? containerOrReferenceName 
            : containerOrReferenceName.referenceName;
        
        const contentDefinitionID = typeof containerOrReferenceName === 'string' 
            ? undefined 
            : containerOrReferenceName.contentDefinitionID;

        // Check mapper cache first
        const mapping = referenceMapper.getMapping<mgmtApi.Container>('container', 'referenceName', referenceName);
        if (mapping?.target) {
            return mapping.target;
        }

        // Try to find container by reference name in target instance
        try {
            const targetContainer = await apiClient.containerMethods.getContainerByReferenceName(referenceName, guid);
            if (targetContainer) {
                return targetContainer;
            }
        } catch (error: any) {
            // Container not found with exact case - try case-insensitive search
            try {
                const allContainers = await apiClient.containerMethods.getContainerList(guid);
                const caseInsensitiveMatch = allContainers.find(c => 
                    c.referenceName && referenceName &&
                    c.referenceName.toLowerCase() === referenceName.toLowerCase()
                );
                
                if (caseInsensitiveMatch) {
                    return caseInsensitiveMatch;
                }
            } catch (listError: any) {
                // Continue to model-based lookup
            }
        }

        // Try to find by model mapping (for containers with model dependencies) - only if we have contentDefinitionID
        if (contentDefinitionID) {
            const modelMapping = referenceMapper.getMapping<mgmtApi.Model>('model', 'id', contentDefinitionID);
            if (modelMapping?.target) {
                try {
                    // Get all containers and find one with matching model ID and EXACT reference name
                    const allContainers = await apiClient.containerMethods.getContainerList(guid);
                    const potentialMatch = allContainers.find(c => 
                        c.contentDefinitionID === modelMapping.target.id &&
                        (c.referenceName === referenceName || 
                         (c.referenceName && referenceName && 
                          c.referenceName.toLowerCase() === referenceName.toLowerCase()))
                    );

                    if (potentialMatch) {
                        return potentialMatch;
                    }
                } catch (error: any) {
                    // Continue - will create new container
                }
            }
        }

        // container not found in target instance
        // console.log(ansiColors.yellow(`✗ Container Not found in target instance: ${referenceName}`));
        return null;

    } catch (error: any) {
        if (error.response && error.response.status === 404) {
            return null;
        }
        // console.error(`[Container Finder] Error searching for ${typeof containerOrReferenceName === 'string' ? containerOrReferenceName : containerOrReferenceName.referenceName}:`, error.message);
        throw error;
    }
}
