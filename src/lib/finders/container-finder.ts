import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../reference-mapper';

export async function findContainerInTargetInstance(
    container: mgmtApi.Container, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null> {
    try {
        // Check mapper cache first
        const mapping = referenceMapper.getMapping<mgmtApi.Container>('container', 'referenceName', container.referenceName);
        if (mapping?.target) {
            return mapping.target;
        }

        // Try to find container by reference name in target instance
        try {
            const targetContainer = await apiClient.containerMethods.getContainerByReferenceName(container.referenceName, guid);
            if (targetContainer) {
                return targetContainer;
            }
        } catch (error: any) {
            // Container not found - this is normal, will create new one
        }

        // Try to find by model mapping (for containers with model dependencies)
        const modelMapping = referenceMapper.getMapping<mgmtApi.Model>('model', 'id', container.contentDefinitionID);
        if (modelMapping?.target) {
            try {
                // Get all containers and find one with matching model ID
                const allContainers = await apiClient.containerMethods.getContainerList(guid);
                const potentialMatch = allContainers.find(c => 
                    c.contentDefinitionID === modelMapping.target.id &&
                    (c.referenceName === container.referenceName || 
                     c.referenceName.startsWith(container.referenceName.split(/[A-F0-9]{6}$/)[0])) // Handle hashed names
                );

                if (potentialMatch) {
                    return potentialMatch;
                }
            } catch (error: any) {
                // Continue - will create new container
            }
        }

        return null;

    } catch (error: any) {
        if (error.response && error.response.status === 404) {
            return null;
        }
        throw error;
    }
}
