import { ApiClient } from '@agility/management-sdk';

/**
 * A robust function to find a container in the target instance using multiple strategies.
 * @param referenceName The reference name of the container to find.
 * @param apiClient The initialized Agility API client.
 * @param guid The GUID of the target instance.
 * @returns The container object if found, otherwise null.
 */
export async function getContainer(referenceName: string, apiClient: ApiClient, guid:string): Promise<any | null> {
    // 1. Try direct lookup first
    try {
        const container = await apiClient.containerMethods.getContainerByReferenceName(referenceName, guid);
        if (container) return container;
    } catch (error: any) {
        // Suppress 404s, but log other errors
        if (error.response?.status !== 404) {
             console.error(`Error fetching container by direct name "${referenceName}":`, error.message);
        }
    }

    // 2. Try normalized names (often content item ref names are used for containers)
    // Example: "My Item" -> "myitem"
    const normalizedName = referenceName.toLowerCase().replace(/\s/g, '');
    if (normalizedName !== referenceName) {
        try {
            const container = await apiClient.containerMethods.getContainerByReferenceName(normalizedName, guid);
            if (container) return container;
        } catch (error: any) {
            // Suppress 404s
        }
    }

    // 3. Fallback: Get all containers and find one with a matching reference name or a reference name that *starts with* the content's reference name.
    // This handles cases where Agility adds a hash to the container name (e.g., 'myitem' -> 'myitema2b4c6')
    try {
        const allContainers = await apiClient.containerMethods.getContainerList(guid);
        const bestMatch = allContainers.find(c => 
            c.referenceName === referenceName || 
            c.referenceName === normalizedName || 
            c.referenceName.startsWith(normalizedName)
        );

        if (bestMatch) {
            return bestMatch;
        }
    } catch (error: any) {
        console.error(`Error fetching container list for fallback search:`, error.message);
        throw error; // Re-throw if we can't get the list
    }

    // If all else fails, return null
    return null;
}

/**
 * Fetches a model from the target instance by its reference name.
 * @param referenceName The reference name of the model.
 * @param apiClient The initialized Agility API client.
 * @param guid The GUID of the target instance.
 * @returns The model object if found, otherwise null.
 */
export async function getModel(referenceName: string, apiClient: ApiClient, guid: string): Promise<any | null> {
    try {
        const model = await apiClient.modelMethods.getModelByReferenceName(referenceName, guid);
        return model;
    } catch (error: any) {
        if (error.response && error.response.status === 404) {
            return null; // Not found is a valid case
        }
        console.error(`Error fetching model "${referenceName}":`, error.message);
        throw error;
    }
} 