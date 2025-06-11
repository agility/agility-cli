import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../reference-mapper';
import ansiColors from 'ansi-colors';

export async function findContainerInTargetInstance(
    container: mgmtApi.Container, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null> {
    try {
        console.log(ansiColors.yellow(`[Container Finder] Looking for container: ${container.referenceName} (ID: ${container.contentViewID})`));
        
        // CRITICAL FIX: Always verify via API calls FIRST, don't trust cached mapper
        // Try to find container by reference name in target instance
        const {referenceName} = container;

        try {
            let targetContainer: mgmtApi.Container | null = await apiClient.containerMethods.getContainerByReferenceName(referenceName, guid);
            
            if (targetContainer) {
                console.log(ansiColors.green(`[Container Finder] ✅ VERIFIED via API: ${targetContainer.referenceName} (ID: ${targetContainer.contentViewID})`));
                // Add to mapper for future optimization (but don't rely on it)
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

        // Try normalized versions of the container name
        const normalizedNames = [
            referenceName.toLowerCase().replace(/\s+/g, ''),           // "playerdetails"  
            referenceName.replace(/\s+/g, ''),                         // "playerdetails"
            referenceName.toLowerCase().replace(/\s+/g, '_'),          // "player_details"
            referenceName.replace(/\s+/g, '_'),                        // "player_details"
            referenceName.split(' ').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            ).join(''),                                                // "PlayerDetails"
        ];

        for (const normalizedName of normalizedNames) {
            if (normalizedName === referenceName) continue; // Skip if same as original
            
            try {
                console.log(ansiColors.yellow(`[Container Finder] Trying normalized name via API: ${normalizedName}`));
                let targetContainer: mgmtApi.Container | null = await apiClient.containerMethods.getContainerByReferenceName(normalizedName, guid);
                
                if (targetContainer) {
                    console.log(ansiColors.green(`[Container Finder] ✅ VERIFIED via API (normalized): ${targetContainer.referenceName} (ID: ${targetContainer.contentViewID})`));
                    // Add to mapper for future optimization
                    referenceMapper.addRecord('container', container, targetContainer);
                    return targetContainer;
                }
            } catch (error: any) {
                // Continue to next normalized name
                console.log(ansiColors.yellow(`[Container Finder] Normalized name not found: ${normalizedName}`));
            }
        }

        // Check for hashed container name mappings (only if we have valid API-verified data)
        const nameMapping = referenceMapper.getMapping<{originalName: string, hashedName: string}>('container-name', 'originalName', container.referenceName);
        if (nameMapping?.target?.hashedName) {
            console.log(ansiColors.yellow(`[Container Finder] Checking hashed name via API: ${nameMapping.target.hashedName}`));
            try {
                const hashedContainer = await apiClient.containerMethods.getContainerByReferenceName(nameMapping.target.hashedName, guid);
                if (hashedContainer) {
                    console.log(ansiColors.green(`[Container Finder] ✅ VERIFIED via API (hashed): ${hashedContainer.referenceName} (ID: ${hashedContainer.contentViewID})`));
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
            console.log(ansiColors.yellow(`[Container Finder] Trying to find by mapped model ID via API: ${modelMapping.target.id}`));
            
            try {
                // Get all containers and find one with matching model ID and similar reference name
                const allContainers = await apiClient.containerMethods.getContainerList(guid);
                
                const potentialMatches = allContainers.filter(c => 
                    c.contentDefinitionID === modelMapping.target.id &&
                    (c.referenceName === container.referenceName || 
                     c.referenceName.startsWith(container.referenceName) ||
                     container.referenceName.startsWith(c.referenceName.split(/[A-F0-9]{6}$/)[0]) || // Handle hashed names
                     // Add normalized name matching
                     normalizedNames.includes(c.referenceName) ||
                     c.referenceName.toLowerCase().replace(/\s+/g, '') === referenceName.toLowerCase().replace(/\s+/g, ''))
                );

                if (potentialMatches.length > 0) {
                    const bestMatch = potentialMatches[0]; // Take the first match
                    console.log(ansiColors.green(`[Container Finder] ✅ VERIFIED via API (model match): ${bestMatch.referenceName} (ID: ${bestMatch.contentViewID})`));
                    referenceMapper.addRecord('container', container, bestMatch);
                    return bestMatch;
                }
            } catch (error: any) {
                console.error(ansiColors.red(`[Container Finder] Error searching all containers: ${error.message}`));
            }
        }

        // FINAL CHECK: As optimization only, check mapper for previously verified results
        // This should only be used for containers we've already API-verified in this session
        const mapping = referenceMapper.getMapping<mgmtApi.Container>('container', 'referenceName', container.referenceName);
        if (mapping?.target) {
            console.log(ansiColors.cyan(`[Container Finder] Found in cache (previously verified): ${mapping.target.referenceName} (ID: ${mapping.target.contentViewID})`));
            // CRITICAL: Still verify it exists via API to ensure cache is valid
            try {
                const verifyContainer = await apiClient.containerMethods.getContainerByReferenceName(mapping.target.referenceName, guid);
                if (verifyContainer) {
                    console.log(ansiColors.green(`[Container Finder] ✅ CACHE VERIFIED via API: ${verifyContainer.referenceName} (ID: ${verifyContainer.contentViewID})`));
                    return verifyContainer;
                } else {
                    console.log(ansiColors.red(`[Container Finder] ❌ CACHE INVALID - container no longer exists, removing from mapper`));
                    // TODO: Remove invalid mapping from cache
                    return null;
                }
            } catch (error: any) {
                console.log(ansiColors.red(`[Container Finder] ❌ CACHE INVALID - API verification failed: ${error.message}`));
                return null;
            }
        }

        console.log(ansiColors.red(`[Container Finder] ❌ NO CONTAINER FOUND via API for: ${container.referenceName}`));
        return null;

    } catch (error: any) {
        console.error(ansiColors.red(`[Container Finder] Unexpected error for ${container.referenceName}: ${error.message}`));
        if (error.response && error.response.status === 404) {
            return null;
        }
        throw error;
    }
}
