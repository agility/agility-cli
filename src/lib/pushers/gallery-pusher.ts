import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapper } from "../shared/reference-mapper";
import { findGalleryInTargetInstance } from "../finders";
import { state } from '../../core/state';

export async function pushGalleries(
    sourceData: any,
    targetData: any,
    referenceMapper: ReferenceMapper,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successful: number, failed: number, skipped: number }> {
    
    // Extract data from sourceData - unified parameter pattern
    const galleries: mgmtApi.assetMediaGrouping[] = sourceData.galleries || [];
 
    if (!galleries || galleries.length === 0) {
        console.log('No galleries found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0 };
    }

    // Get state values instead of prop drilling
    const { targetGuid } = state;
    const { getApiClient } = await import('../../core/state');
    const apiClient = getApiClient();

    const totalGroupings = galleries.length;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const mediaGrouping of galleries) {
        let currentStatus: 'success' | 'error' = 'success';
        try {
            // Use gallery-finder to determine what action to take
            const existingGallery = await findGalleryInTargetInstance(mediaGrouping, apiClient, targetGuid[0], targetData, referenceMapper);
            const { gallery, shouldUpdate, shouldCreate, shouldSkip } = existingGallery;

            if (shouldCreate) {
                // Gallery needs to be created (doesn't exist in target)
                await createGallery(mediaGrouping, apiClient, targetGuid[0], referenceMapper);
                successful++;
                
            } else if (shouldUpdate) {
                // Gallery exists but needs updating
                await updateGallery(mediaGrouping, gallery, apiClient, targetGuid[0], referenceMapper);
                successful++;
                
            } else if (shouldSkip) {
                // Gallery exists and is up to date - skip
                console.log(`✓ Gallery ${ansiColors.underline(mediaGrouping.name)} ${ansiColors.bold.gray('up to date, skipping')}`);
                
                // Add mapping for existing gallery
                if (gallery) {
                    referenceMapper.addRecord('gallery', mediaGrouping, gallery);
                }
                skipped++;
            }

        } catch (error: any) {
            console.error(`✗ Error processing gallery ${mediaGrouping.name}:`, error.message);
            failed++;
            currentStatus = 'error';
            overallStatus = 'error';
        } finally {
            processedCount++;
            if (onProgress) {
                onProgress(processedCount, totalGroupings, currentStatus);
            }
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
    referenceMapper: ReferenceMapper
): Promise<void> {
    const payload = { ...mediaGrouping, mediaGroupingID: 0 };
    const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
    referenceMapper.addRecord('gallery', mediaGrouping, savedGallery);
    console.log(`✓ Gallery created: ${mediaGrouping.name} - ${ansiColors.green('Source')}: ${mediaGrouping.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
}

/**
 * Update an existing gallery in the target instance
 */
async function updateGallery(
    sourceGallery: mgmtApi.assetMediaGrouping,
    existingGallery: mgmtApi.assetMediaGrouping,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapper
): Promise<void> {
    const payload = { ...sourceGallery, mediaGroupingID: existingGallery.mediaGroupingID };
    const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
    referenceMapper.addRecord('gallery', sourceGallery, savedGallery);
    console.log(`✓ Gallery updated: ${sourceGallery.name} - ${ansiColors.green('Source')}: ${sourceGallery.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
}