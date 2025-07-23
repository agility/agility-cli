import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import { state, getState } from '../../core/state';
import { ChangeDeltaFileWorker } from "lib/shared/change-delta-file-worker";
import { GalleryMapper } from "lib/mappers/gallery-mapper";
import { getApiClient } from "../../core/state";

/**
 * Enhanced gallery finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */

export async function pushGalleries(
    sourceData: mgmtApi.assetMediaGrouping[],
    targetData: mgmtApi.assetMediaGrouping[],
    // onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successful: number, failed: number, skipped: number }> {
    
    // Extract data from sourceData - unified parameter pattern
    const galleries: mgmtApi.assetMediaGrouping[] = sourceData || [];

   
    if (!galleries || galleries.length === 0) {
        console.log('No galleries found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0 };
    }

    // Get state values instead of prop drilling
    const { sourceGuid, targetGuid } = state;
    const apiClient = getApiClient();


    const referenceMapper = new GalleryMapper(sourceGuid[0], targetGuid[0]);

    const totalGroupings = galleries.length;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const sourceGallery of galleries) {
        let currentStatus: 'success' | 'error' = 'success';
        try {
            
            const existingMapping = referenceMapper.getGalleryMapping(sourceGallery, "target");
            const shouldCreate = existingMapping === null;
            
            const targetGallery: mgmtApi.assetMediaGrouping = targetData.find(targetGallery => targetGallery.mediaGroupingID === sourceGallery.mediaGroupingID) || null;
 
            const isTargetSafe = existingMapping !== null && referenceMapper.hasTargetChanged(targetGallery);
            const hasSourceChanges = existingMapping !== null && referenceMapper.hasSourceChanged(sourceGallery);
            const shouldUpdate = existingMapping !== null && isTargetSafe && hasSourceChanges;
            const shouldSkip = existingMapping !== null && !isTargetSafe && !hasSourceChanges;
            

            if (shouldCreate) {
                // Gallery needs to be created (doesn't exist in target)
                await createGallery(sourceGallery, apiClient, targetGuid[0], referenceMapper);
                successful++;
                
            } else if (shouldUpdate) {
                // Gallery exists but needs updating
                await updateGallery(sourceGallery, targetGallery, apiClient, targetGuid[0], referenceMapper);
                successful++;
                
            } else if (shouldSkip) {
                // Gallery exists and is up to date - skip
                console.log(`✓ Gallery ${ansiColors.underline(sourceGallery.name)} ${ansiColors.bold.gray('up to date, skipping')}`);
                
                // Add mapping for existing gallery
                // if (existingMapping) {
                //     referenceMapper.updateMapping(mediaGrouping, mediaGrouping);
                // }
                skipped++;
            }

        } catch (error: any) {
            console.error(`✗ Error processing gallery ${sourceGallery.name}:`, error.message);
            failed++;
            currentStatus = 'error';
            overallStatus = 'error';
        } finally {
            processedCount++;
            // if (onProgress) {
            //     onProgress(processedCount, totalGroupings, currentStatus);
            // }
        }
    }

    console.log(ansiColors.yellow(`Processed ${successful}/${totalGroupings} gallery groupings (${failed} failed, ${skipped} skipped)`));
    return { status: overallStatus, successful, failed, skipped };
}

/**
 * Create a new gallery in the target instance
 */
async function createGallery(
    mediaGrouping: mgmtApi.assetMediaGrouping,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    referenceMapper: GalleryMapper
): Promise<void> {
    const payload = { ...mediaGrouping, mediaGroupingID: 0 };
    const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
    referenceMapper.addMapping(mediaGrouping, savedGallery);
    console.log(`✓ Gallery created: ${mediaGrouping.name} - ${ansiColors.green('Source')}: ${mediaGrouping.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
}

/**
 * Update an existing gallery in the target instance
 */
async function updateGallery(
    sourceGallery: mgmtApi.assetMediaGrouping,
    targetGallery: mgmtApi.assetMediaGrouping,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    referenceMapper: GalleryMapper
): Promise<void> {
    const payload = { ...sourceGallery, mediaGroupingID: targetGallery.mediaGroupingID };
    const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
    referenceMapper.addMapping(sourceGallery, savedGallery);
    console.log(`✓ Gallery updated: ${sourceGallery.name} - ${ansiColors.green('Source')}: ${sourceGallery.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
}