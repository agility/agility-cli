import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";

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
            console.log(`[Container Debug] ✓ Found in cache: ${referenceName} → ID:${mapping.target.contentViewID}`);
            return mapping.target;
        }

        // Try to find container by reference name in target instance
        try {
            const targetContainer = await apiClient.containerMethods.getContainerByReferenceName(referenceName, guid);
            if (targetContainer) {
                console.log(`[Container Debug] ✓ Found by API: ${referenceName} → ID:${targetContainer.contentViewID}`);
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
                    console.log(`[Container Debug] ✓ Found case-insensitive: "${referenceName}" → "${caseInsensitiveMatch.referenceName}" ID:${caseInsensitiveMatch.contentViewID}`);
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
                        console.log(`[Container Debug] ✓ Found by model mapping: ${referenceName} → ID:${potentialMatch.contentViewID}`);
                        return potentialMatch;
                    }
                } catch (error: any) {
                    // Continue - will create new container
                }
            }
        }

        console.log(`[Container Debug] ✗ Not found: ${referenceName}`);
        return null;

    } catch (error: any) {
        if (error.response && error.response.status === 404) {
            return null;
        }
        // console.error(`[Container Finder] Error searching for ${typeof containerOrReferenceName === 'string' ? containerOrReferenceName : containerOrReferenceName.referenceName}:`, error.message);
        throw error;
    }
}
