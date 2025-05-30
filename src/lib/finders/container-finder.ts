import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../mapper';
import ansiColors from 'ansi-colors';

export async function findContainerInTargetInstance(
    container: mgmtApi.Container, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null> {
    try {
        console.log(ansiColors.yellow(`[Container Finder] Looking for container: ${container.referenceName} (ID: ${container.contentViewID})`));
        
        // First check the reference mapper for a container with the same reference name
        const mapping = referenceMapper.getMapping<mgmtApi.Container>('container', 'referenceName', container.referenceName);
       
        if (mapping?.target) {
            console.log(ansiColors.green(`[Container Finder] Found in mapper: ${mapping.target.referenceName} (ID: ${mapping.target.contentViewID})`));
            return mapping.target;
        }

        // Try to find container by reference name in target instance
        const {referenceName} = container;

        try {
            let targetContainer: mgmtApi.Container | null = await apiClient.containerMethods.getContainerByReferenceName(referenceName, guid);
            
            if (targetContainer) {
                console.log(ansiColors.green(`[Container Finder] Found by referenceName: ${targetContainer.referenceName} (ID: ${targetContainer.contentViewID})`));
                // Add to mapper for future lookups
                referenceMapper.addRecord('container', container, targetContainer);
                return targetContainer;
            } else {
                console.log(ansiColors.yellow(`[Container Finder] Not found by referenceName: ${referenceName}`));
            }

        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                console.log(ansiColors.yellow(`[Container Finder] Container not found (404): ${referenceName}`));
            } else {
                console.error(ansiColors.red(`[Container Finder] Error looking up container ${referenceName}: ${error.message}`));
            }
        }

        // Check for hashed container name mappings
        const nameMapping = referenceMapper.getMapping<{originalName: string, hashedName: string}>('container-name', 'originalName', container.referenceName);
        if (nameMapping?.target?.hashedName) {
            console.log(ansiColors.yellow(`[Container Finder] Checking hashed name: ${nameMapping.target.hashedName}`));
            try {
                const hashedContainer = await apiClient.containerMethods.getContainerByReferenceName(nameMapping.target.hashedName, guid);
                if (hashedContainer) {
                    console.log(ansiColors.green(`[Container Finder] Found by hashed name: ${hashedContainer.referenceName} (ID: ${hashedContainer.contentViewID})`));
                    referenceMapper.addRecord('container', container, hashedContainer);
                    return hashedContainer;
                }
            } catch (error: any) {
                console.log(ansiColors.yellow(`[Container Finder] Hashed name also not found: ${nameMapping.target.hashedName}`));
            }
        }

        // Try to find by contentDefinitionID if we have a model mapping
        const modelMapping = referenceMapper.getMapping<mgmtApi.Model>('model', 'id', container.contentDefinitionID);
        if (modelMapping?.target) {
            console.log(ansiColors.yellow(`[Container Finder] Trying to find by mapped model ID: ${modelMapping.target.id}`));
            
            try {
                // Get all containers and find one with matching model ID and similar reference name
                const allContainers = await apiClient.containerMethods.getContainerList(guid);
                
                const potentialMatches = allContainers.filter(c => 
                    c.contentDefinitionID === modelMapping.target.id &&
                    (c.referenceName === container.referenceName || 
                     c.referenceName.startsWith(container.referenceName) ||
                     container.referenceName.startsWith(c.referenceName.split(/[A-F0-9]{6}$/)[0])) // Handle hashed names
                );

                if (potentialMatches.length > 0) {
                    const bestMatch = potentialMatches[0]; // Take the first match
                    console.log(ansiColors.green(`[Container Finder] Found potential match: ${bestMatch.referenceName} (ID: ${bestMatch.contentViewID})`));
                    referenceMapper.addRecord('container', container, bestMatch);
                    return bestMatch;
                }
            } catch (error: any) {
                console.error(ansiColors.red(`[Container Finder] Error searching all containers: ${error.message}`));
            }
        }

        console.log(ansiColors.red(`[Container Finder] No container found for: ${container.referenceName}`));
        return null;

    } catch (error) {
        console.error(ansiColors.red(`[Container Finder] Unexpected error for ${container.referenceName}: ${error.message}`));
        if (error.response && error.response.status === 404) {
            return null;
        }
        throw error;
    }
}
