import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';
import ansiColors from 'ansi-colors';

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
    const allGalleries = galleryLists.flatMap((galleryList: any) => 
        galleryList.assetMediaGroupings || []
    );
    
    // Deduplicate galleries by mediaGroupingID to prevent double processing
    const uniqueGalleries = allGalleries.filter((gallery, index, array) => 
        array.findIndex(g => g.mediaGroupingID === gallery.mediaGroupingID) === index
    );
    
    return uniqueGalleries;
}
