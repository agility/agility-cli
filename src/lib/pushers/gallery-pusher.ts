import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapper } from "../shared/reference-mapper";
import { state } from '../../core/state';

export async function pushGalleries(
    sourceData: any,
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
    const apiClient = state.apiClient;

    const totalGroupings = galleries.length;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const mediaGrouping of galleries) {
        try {
            // Add source gallery to reference mapper for tracking
            referenceMapper.addRecord('gallery', mediaGrouping, null);

            // Try to get existing gallery
            let existingGallery;
            try {
                existingGallery = await apiClient.assetMethods.getGalleryByName(targetGuid, mediaGrouping.name);
            } catch (error) {
                // Gallery doesn't exist, which is fine - we'll create it
                existingGallery = null;
            }

            if (existingGallery) {
                // Gallery exists, update the reference mapping - this is a skip, not success
                referenceMapper.addRecord('gallery', mediaGrouping, existingGallery);
                console.log(`✓ Gallery ${ansiColors.underline(mediaGrouping.name)} ${ansiColors.bold.gray('exists')} - ${ansiColors.green(targetGuid)}: ${existingGallery.mediaGroupingID}`);
                skipped++; // Existing galleries are skipped, not successful
            } else {
                // Create new gallery
                const payload = { ...mediaGrouping, mediaGroupingID: 0 };
                const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
                referenceMapper.addRecord('gallery', mediaGrouping, savedGallery);
                console.log(`✓ Gallery created: ${mediaGrouping.name} - ${ansiColors.green('Source')}: ${mediaGrouping.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
                successful++;
            }
        } catch (error: any) {
            console.error(`✗ Error processing gallery ${mediaGrouping.name}:`, error.message);
            failed++;
            overallStatus = 'error';
        }

        processedCount++;
        if (onProgress) {
            onProgress(processedCount, totalGroupings, overallStatus);
        }
    }

    console.log(ansiColors.yellow(`Processed ${successful}/${totalGroupings} gallery groupings (${failed} failed, ${skipped} skipped)`));
    return { status: overallStatus, successful, failed, skipped };
}