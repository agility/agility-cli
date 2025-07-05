import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';

/**
 * Get galleries from filesystem without side effects
 * Includes flattening of assetMediaGroupings arrays (from ChainDataLoader logic)
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getGalleriesFromFileSystem(
    fileOps: fileOperations
): mgmtApi.assetMediaGrouping[] {
    const galleryLists = fileOps.readJsonFilesFromFolder('assets/galleries');
    
    // Flatten assetMediaGroupings arrays (exact logic from ChainDataLoader)
    return galleryLists.flatMap((galleryList: any) => 
        galleryList.assetMediaGroupings || []
    );
}
