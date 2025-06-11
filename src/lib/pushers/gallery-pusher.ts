import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapper } from "../reference-mapper";

export async function pushGalleries(
    galleries: mgmtApi.assetGalleries[], 
    targetGuid: string, 
    apiClient: mgmtApi.ApiClient,
    referenceMapper: ReferenceMapper,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successfulGroupings: number, failedGroupings: number }> {
 
    if (!galleries || galleries.length === 0) {
        console.log('No galleries found to process.');
        return { status: 'success', successfulGroupings: 0, failedGroupings: 0 };
    }

    let totalGroupings = 0;
    for (const gallery of galleries) {
        totalGroupings += gallery.assetMediaGroupings.length;
    }

    let successfulGroupings = 0;
    let failedGroupings = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const gallery of galleries) {
        for (const mediaGrouping of gallery.assetMediaGroupings) {
            try {
                // Try to get existing gallery
                let existingGallery;
                try {
                    existingGallery = await apiClient.assetMethods.getGalleryByName(targetGuid, mediaGrouping.name);
                } catch (error) {
                    // Gallery doesn't exist, which is fine - we'll create it
                    existingGallery = null;
                }

                if (existingGallery) {
                    // Gallery exists, just map the reference
                    referenceMapper.addRecord('gallery', mediaGrouping, existingGallery);
                    console.log(`✓ Gallery ${ansiColors.underline(mediaGrouping.name)} ${ansiColors.bold.gray('exists')} - ${ansiColors.green(targetGuid)}: ${existingGallery.mediaGroupingID}`);
                    successfulGroupings++;
                } else {
                    // Create new gallery
                    const payload = { ...mediaGrouping, mediaGroupingID: 0 };
                    const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
                    referenceMapper.addRecord('gallery', mediaGrouping, savedGallery);
                    console.log(`✓ Gallery created: ${mediaGrouping.name} - ${ansiColors.green('Source')}: ${mediaGrouping.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
                    successfulGroupings++;
                }
            } catch (error: any) {
                console.error(`✗ Error processing gallery ${mediaGrouping.name}:`, error.message);
                failedGroupings++;
                overallStatus = 'error';
            }

            processedCount++;
            if (onProgress) {
                onProgress(processedCount, totalGroupings, overallStatus);
            }
        }
    }

    console.log(ansiColors.yellow(`Processed ${successfulGroupings}/${totalGroupings} gallery groupings (${failedGroupings} failed)`));
    return { status: overallStatus, successfulGroupings, failedGroupings };
}