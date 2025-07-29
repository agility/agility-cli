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


    const galleryFolder = fileOps.getDataFolderPath('galleries');
    const galleryFiles = fileOps.getFolderContents(galleryFolder);
   
    const galleries = [];
    for(const galleryFile of galleryFiles){
        const gallery = fileOps.readJsonFile(`galleries/${galleryFile}`);
        galleries.push(gallery);
    }

    
    // Deduplicate galleries by mediaGroupingID to prevent double processing
    const uniqueGalleries = galleries.filter((gallery, index, array) => 
        array.findIndex(g => g.mediaGroupingID === gallery.mediaGroupingID) === index
    );
    
    return uniqueGalleries;
}
