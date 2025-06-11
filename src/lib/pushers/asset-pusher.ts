import ansiColors from "ansi-colors";
import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../reference-mapper";
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
            // Add source asset to reference mapper for tracking
            referenceMapper.addRecord('asset', media, null);

            const relativeFilePath = getAssetFilePath(media.originUrl).replace(/%20/g, " "); // Uses imported util
            const absoluteLocalFilePath = path.join(basePath, relativeFilePath);
            const folderPath = path.dirname(relativeFilePath) === '.' ? '/' : path.dirname(relativeFilePath);

            // Check if asset exists in mapper or target instance
            let existingMedia = referenceMapper.getMapping('asset', media.mediaID);
            
            if (!existingMedia) {
                // Asset not in mapper, check target instance directly
                try {
                    const mediaList = await apiClient.assetMethods.getMediaList(1000, 0, targetGuid);
                    existingMedia = mediaList.assetMedias?.find((a: any) => 
                        a.fileName === media.fileName ||
                        a.originUrl === media.originUrl ||
                        a.edgeUrl === media.originUrl
                    );
                    
                    if (existingMedia) {
                        // Add to mapper for future reference
                        referenceMapper.addRecord('asset', media, existingMedia);
                    }
                } catch (error) {
                    // If asset lookup fails, continue with upload attempt
                    existingMedia = null;
                }
            }

            if (existingMedia) {
                // Asset exists, update the reference mapping
                referenceMapper.addRecord('asset', media, existingMedia); 
                const sourceFileName = media.originUrl.split('/').pop()?.split('?')[0];
                const targetFileName = (existingMedia as any).originUrl?.split('/').pop()?.split('?')[0];
                console.log(`✓ Asset ${ansiColors.underline(sourceFileName || 'unknown')} ${ansiColors.bold.grey('exists')} - ${ansiColors.green(targetGuid)}: mediaID:${(existingMedia as any).mediaID} (${targetFileName})`);
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
                                    console.warn(`Could not find source gallery grouping named ${media.mediaGroupingName} in the input list.`);
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
                
                referenceMapper.addRecord('asset', media, uploadedMedia);
                console.log(`✓ Asset uploaded: ${media.fileName} to ${folderPath} - ${ansiColors.green('Source')}: ${media.mediaID} ${ansiColors.green(targetGuid)}: ${uploadedMedia.mediaID}`);
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