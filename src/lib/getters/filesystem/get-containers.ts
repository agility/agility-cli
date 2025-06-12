import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../services/fileOperations';

/**
 * Get containers from filesystem without side effects
 * Uses Joel's container downloader data from /containers directory
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getContainersFromFileSystem(
    fileOps: fileOperations
): mgmtApi.Container[] {
    // Load container metadata from Joel's downloader
    const containerData = fileOps.readJsonFilesFromFolder('containers');
    const listData = fileOps.readJsonFilesFromFolder('list');
    
    // Create lookup map for list data by reference name
    const listLookup = new Map<string, any[]>();
    for (const listFile of listData) {
        if (Array.isArray(listFile) && listFile.length > 0) {
            // Try to infer reference name from list file structure
            // List files are typically named after the container reference name
            const firstItem = listFile[0];
            if (firstItem && firstItem.properties) {
                // Extract container reference from content structure
                const containerRef = Object.keys(firstItem.properties).find(key => 
                    firstItem.properties[key] && typeof firstItem.properties[key] === 'object'
                );
                if (containerRef) {
                    listLookup.set(containerRef, listFile);
                }
            }
        }
    }
    
    // Process containers and enrich with content data
    return containerData.map(container => {
        // Load content items for this container from /list directory
        const contentItems = listLookup.get(container.referenceName) || [];
        
        return {
            ...container,
            contentCount: contentItems.length,
            _contentItems: contentItems // Store for reference
        };
    });
} 