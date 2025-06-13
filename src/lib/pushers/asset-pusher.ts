import ansiColors from "ansi-colors";
import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../reference-mapper";
import { findAssetInTargetInstance } from "../finders/asset-finder";
import * as fs from 'fs';
import * as path from 'path';
import { getAssetFilePath } from "../utilities/asset-utils"; // Import the utility
const FormData = require("form-data");

export async function pushAssets(
    assets: mgmtApi.Media[], 
    allGalleries: mgmtApi.assetMediaGrouping[],
    sourceGuid: string, 
    targetGuid: string, 
    locale: string, 
    isPreview: boolean, 
    apiClient: mgmtApi.ApiClient, 
    referenceMapper: ReferenceMapper, 
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successfulAssets: number, failedAssets: number }> {
    
    if (!assets || assets.length === 0) {
        console.log('No assets found to process.');
        return { status: 'success', successfulAssets: 0, failedAssets: 0 };
    }

    let defaultContainer: mgmtApi.assetContainer | null = null;
    try {
        defaultContainer = await apiClient.assetMethods.getDefaultContainer(targetGuid);
    } catch (err: any) {
        console.error("✗ Error fetching default asset container:", err.message);
        return { status: 'error', successfulAssets: 0, failedAssets: 0 }; 
    }
    
    const totalAssets = assets.length;
    let successfulAssets = 0;
    let failedAssets = 0;
    let processedAssetsCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    const basePath = path.join(process.cwd(), 'agility-files', sourceGuid, locale, isPreview ? 'preview' : 'live', 'assets');

    for (const media of assets) {
        let currentStatus: 'success' | 'error' = 'success';
        try {
            // PERFORMANCE FIX: Don't add null records upfront - this pollutes the mapping cache
            // referenceMapper.addRecord('asset', media, null); // REMOVED

            const relativeFilePath = getAssetFilePath(media.originUrl).replace(/%20/g, " "); // Uses imported util
            const absoluteLocalFilePath = path.join(basePath, relativeFilePath);
            const folderPath = path.dirname(relativeFilePath) === '.' ? '/' : path.dirname(relativeFilePath);

            // SIMPLIFICATION: Use finder function instead of manual mapping/API logic
            const existingMedia = await findAssetInTargetInstance(media, apiClient, targetGuid, referenceMapper);

            if (existingMedia) {
                // Asset exists in target instance
                const sourceFileName = media.originUrl.split('/').pop()?.split('?')[0];
                const targetFileName = existingMedia.originUrl?.split('/').pop()?.split('?')[0];
                console.log(`✓ Asset ${ansiColors.underline(sourceFileName || 'unknown')} ${ansiColors.bold.grey('exists')} - ${ansiColors.green(targetGuid)}: mediaID:${existingMedia.mediaID} (${targetFileName})`);
                successfulAssets++; // Count existing as success for progress
            } else {
                // Handle gallery if present
                let targetMediaGroupingID = -1;
                if (media.mediaGroupingID > 0 && media.mediaGroupingName) {
                    try {
                        // Check mapper first
                        const galleryMapping = referenceMapper.getMappingByKey<mgmtApi.assetMediaGrouping>('gallery', 'name', media.mediaGroupingName);
                        if (galleryMapping && galleryMapping.target) {
                            targetMediaGroupingID = galleryMapping.target.mediaGroupingID;
                        } else {
                            // Fallback: Check API directly if not in mapper
                            const gallery = await apiClient.assetMethods.getGalleryByName(targetGuid, media.mediaGroupingName);
                            if (gallery) {
                                targetMediaGroupingID = gallery.mediaGroupingID;
                                // Add mapping if found via API
                                const sourceGalleryGrouping = allGalleries.find(mg => mg.name === media.mediaGroupingName);
                                
                                if (sourceGalleryGrouping) {
                                    referenceMapper.addRecord('gallery', sourceGalleryGrouping, gallery);
                                } else {
                                    // Create synthetic source gallery for mapping persistence
                                    const syntheticSourceGallery = {
                                        mediaGroupingID: media.mediaGroupingID,
                                        name: media.mediaGroupingName,
                                        description: '',
                                        isActive: true
                                    };
                                    referenceMapper.addRecord('gallery', syntheticSourceGallery, gallery);
                                    console.log(`[Asset] Created synthetic gallery mapping for ${media.mediaGroupingName} (source ID: ${media.mediaGroupingID} -> target ID: ${gallery.mediaGroupingID})`);
                                }
                            }
                        }
                    } catch (error: any) {
                        // Gallery doesn't exist - this is normal, asset will upload without gallery
                        console.log(`[Asset] Gallery ${media.mediaGroupingName} not found - asset will upload without gallery association`);
                        // Gallery not found, will upload without gallery
                    }
                }

                // Upload the asset
                const form = new FormData();
                if (!fs.existsSync(absoluteLocalFilePath)) {
                    throw new Error(`Local asset file not found: ${absoluteLocalFilePath}`);
                }
                const fileBuffer = fs.readFileSync(absoluteLocalFilePath);
                form.append('files', fileBuffer, media.fileName);
                
                const uploadedMediaArray = await apiClient.assetMethods.upload(form, folderPath, targetGuid, targetMediaGroupingID);
                
                if (!uploadedMediaArray || uploadedMediaArray.length === 0) {
                    throw new Error(`API did not return uploaded media details for ${media.fileName}`);
                }
                const uploadedMedia = uploadedMediaArray[0]; // Assuming the first item corresponds to our upload
                
                // PERFORMANCE FIX: Add mapping only after successful upload
                referenceMapper.addRecord('asset', media, uploadedMedia);
                console.log(`✓ Asset uploaded: ${media.fileName} to ${folderPath} - ${ansiColors.green('Source')}: ${media.mediaID} ${ansiColors.green(targetGuid)}: ${uploadedMedia.mediaID}`);
                console.log(`[Asset Debug] Added uploaded asset to cache for future lookups`);
                successfulAssets++;
            }
        } catch (error: any) {
            console.error(`✗ Error processing asset ${media.fileName || media.originUrl}:`, error.message);
            failedAssets++;
            currentStatus = 'error';
            overallStatus = 'error';
        } finally {
            // Increment and call progress for each media item
            processedAssetsCount++;
            if (onProgress) {
                onProgress(processedAssetsCount, totalAssets, overallStatus);
            }
        }
    }

    console.log(ansiColors.yellow(`Processed ${successfulAssets}/${totalAssets} assets (${failedAssets} failed)`));
    return { status: overallStatus, successfulAssets, failedAssets };
}