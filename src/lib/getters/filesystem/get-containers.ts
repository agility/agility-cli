import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';

/**
 * Get containers from filesystem without side effects
np * Loads from both /containers directory (page component containers) and /list directory (content list containers)
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getContainersFromFileSystem(
    fileOps: fileOperations
): mgmtApi.Container[] {
    const allContainers: mgmtApi.Container[] = [];
    const processedContainerRefs = new Set<string>();

    // Load container metadata from /containers directory (page component containers)
    const containerData = fileOps.readJsonFilesFromFolder('containers');
    for (const container of containerData) {
        if (container.referenceName && !processedContainerRefs.has(container.referenceName)) {
            allContainers.push(container);
            processedContainerRefs.add(container.referenceName);
        }
    }

    // Load container data from /list directory (content list containers)
    const listData = fileOps.readJsonFilesFromFolder('list');
    
    // Process each list file to extract container information
    for (const listFile of listData) {
        if (Array.isArray(listFile) && listFile.length > 0) {
            // Get container metadata from the first content item's properties
            const firstItem = listFile[0];
            if (firstItem && firstItem.properties && firstItem.properties.referenceName) {
                const containerRef = firstItem.properties.referenceName;
                
                // Only add if we haven't already processed this container
                if (!processedContainerRefs.has(containerRef)) {
                    // Create a synthetic container object from the list data
                    const container = {
                        referenceName: containerRef,
                        contentViewID: -1, // Will be resolved by container pusher
                        contentDefinitionID: firstItem.properties.definitionName ? -1 : null, // Will be resolved by model mapping
                        contentCount: listFile.length,
                        displayName: containerRef,
                        isSystemContainer: false,
                        containerType: 'content',
                        _sourceType: 'list', // Mark as coming from /list directory
                        _contentItems: listFile // Store the list contents for reference
                    } as any;
                    
                    allContainers.push(container);
                    processedContainerRefs.add(containerRef);
                }
            }
        }
    }

    return allContainers;
} 