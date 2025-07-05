import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';

/**
 * Get assets from filesystem without side effects
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getAssetsFromFileSystem(
    fileOps: fileOperations
): mgmtApi.Media[] {
    // Load assets from JSON files in assets/json directory
    const assetData = fileOps.readJsonFilesFromFolder('assets/json');
    const allAssets: mgmtApi.Media[] = [];
    
    // Extract assetMedias array from each JSON file
    for (const data of assetData) {
        if (data.assetMedias && Array.isArray(data.assetMedias)) {
            allAssets.push(...data.assetMedias);
        }
    }
    
    return allAssets;
}


