import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState, state } from "../../core/state";
import ansiColors from "ansi-colors";
import fs from "fs";
import path from "path";
import { ChangeDelta } from "../shared/change-delta-tracker";
import { getAssetFilePath } from "../assets/asset-utils";
import { getAllChannels } from "../shared/get-all-channels";


export async function downloadAllAssets(
  guid: string,
  changeDelta: ChangeDelta
): Promise<void> {
  const fileOps = new fileOperations(guid);
  const update = state.update; // Use state.update instead of parameter
  const apiClient = getApiClient();

  // Note: Using shared getAssetFilePath utility for consistent filename handling
  // This ensures URL decoding is consistent between download and processing phases

  // Helper function to get local asset metadata
  function getLocalAssetInfo(filePath: string): { dateModified?: string; exists: boolean } {
    try {
      if (!fs.existsSync(filePath)) {
        return { exists: false };
      }
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        dateModified: content.dateModified,
        exists: true
      };
    } catch (error) {
      return { exists: false };
    }
  }

  // Helper function to check if asset needs download based on dateModified
  function shouldDownloadAsset(apiAsset: any, localInfo: { dateModified?: string; exists: boolean }): { shouldDownload: boolean; reason: string } {

    if(state.update === false){
      return { shouldDownload: false, reason: '' };
    }

    if (!localInfo.exists) {
      return { shouldDownload: true, reason: 'new file' };
    }

    if (!localInfo.dateModified || !apiAsset.dateModified) {
      return { shouldDownload: true, reason: 'missing date info' };
    }

    const apiDate = new Date(apiAsset.dateModified);
    const localDate = new Date(localInfo.dateModified);

    if (apiDate > localDate) {
      return { shouldDownload: true, reason: 'content changed' };
    }

    return { shouldDownload: false, reason: 'unchanged' };
  }

  // Helper function to format file size
  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
  }

  let pageSize = 250;
  let recordOffset = 0;
  let index = 1;
  let totalSuccessfullyDownloaded = 0;
  let totalSkippedAssets = 0;
  let totalAttemptedToProcess = 0;
  let totalRecords = 0;
  const startTime = Date.now();
  let unProcessedAssets: { [key: number]: string } = {};

  try {
    // Phase 1: Collect all asset metadata from all pages
    let allAssets: any[] = [];
    let initialRecords = await apiClient.assetMethods.getMediaList(
      pageSize,
      recordOffset,
      guid
    );

    totalRecords = initialRecords.totalCount;

    fileOps.createFolder("assets/json");

    // Export first page of JSON
    fileOps.exportFiles("assets/json", index, initialRecords);
    allAssets.push(...initialRecords.assetMedias);
    index++;

    let iterations = Math.ceil(totalRecords / pageSize);
    if (iterations === 0 && totalRecords > 0) iterations = 1;
    else if (totalRecords === 0) iterations = 0;

    // Fetch remaining pages if needed
    if (totalRecords > pageSize) {
      console.log(`📋 Fetching ${iterations - 1} additional pages of asset metadata...`);
      
      for (let iter = 1; iter < iterations; iter++) { 
        recordOffset += pageSize;

        let assetsPage = await apiClient.assetMethods.getMediaList(
          pageSize,
          recordOffset,
          guid
        );

        fileOps.exportFiles("assets/json", index, assetsPage);
        allAssets.push(...assetsPage.assetMedias);
        index++;
      }
    }

    // Phase 2: Process all assets with intelligent change detection
    // console.log(`\n📥 Processing ${totalRecords} assets with smart change detection...`);

    // Group assets by downloadable batches  
    const downloadableAssets = [];
    const skippableAssets = [];
    
         for (const asset of allAssets) {
       const assetJsonPath = path.join(fileOps.getDataFolderPath('assets'), `${asset.mediaID}.json`);
       const localInfo = getLocalAssetInfo(assetJsonPath);
       const downloadDecision = shouldDownloadAsset(asset, localInfo);
       
       if (downloadDecision.shouldDownload) {
         downloadableAssets.push({ asset, reason: downloadDecision.reason });
       } else {
         skippableAssets.push({ asset, reason: downloadDecision.reason });
       }
     }

    console.log(`\nAsset Change Detection Results: ${ansiColors.green(downloadableAssets.length.toString())} to download, ${ansiColors.gray(skippableAssets.length.toString())} unchanged`);

    // Phase 3: Download only the assets that need updating
    if (downloadableAssets.length === 0) {
      // console.log("✅ All assets are up to date!");
      return;
    }

    // Batch processing for downloads
    const CONCURRENT_BATCH_SIZE = 10;
    const batches = [];
    
    for (let i = 0; i < downloadableAssets.length; i += CONCURRENT_BATCH_SIZE) {
      batches.push(downloadableAssets.slice(i, i + CONCURRENT_BATCH_SIZE));
    }

    // Process each batch concurrently
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      // Create download promises for this batch
      const downloadPromises = batch.map(async (item) => {
        const { asset, reason } = item;
        try {
                     // Export asset JSON metadata
           fileOps.exportFiles(`assets`, asset.mediaID.toString(), asset);

          // Download actual file if it has an originUrl
          if (asset.originUrl) {
            const filePath = getAssetFilePath(asset.originUrl);
            const assetFilesPath = path.join(fileOps.getDataFolderPath('assets'), filePath);
            const success = await fileOps.downloadFile(asset.originUrl, assetFilesPath);
            
            if (success) {
              const sizeDisplay = asset.size ? formatFileSize(asset.size) : '';
              console.log(`✓ Downloaded asset ${ansiColors.cyan(asset.fileName)} ${ansiColors.gray(`(${reason})`)} ${ansiColors.gray(sizeDisplay)}`);
              
              // Record successful download in change delta
              if (changeDelta) {
                changeDelta.recordChange({
                  id: asset.mediaID,
                  type: 'asset',
                  action: reason === 'new file' ? 'created' : 'updated',
                  name: asset.fileName,
                  referenceName: asset.fileName,
                });
              }
              
              return { success: true, asset };
            } else {
              throw new Error('Download failed');
            }
          } else {
            // Asset without downloadable file - just metadata
            console.log(`✓ Saved metadata for ${ansiColors.cyan(asset.fileName)} ${ansiColors.gray(`(${reason}, no file)`)}`);
            
            // Record metadata-only update
            if (changeDelta) {
              changeDelta.recordChange({
                id: asset.mediaID,
                type: 'asset',
                action: reason === 'new file' ? 'created' : 'updated',
                name: asset.fileName,
                referenceName: asset.fileName,
              });
            }
            
            return { success: true, asset };
          }
        } catch (error: any) {
          console.error(`✗ Failed to download asset ${ansiColors.red(asset.fileName)}: ${ansiColors.gray(error.message || 'Unknown error')}`);
          unProcessedAssets[asset.mediaID] = asset.fileName;
          return { success: false, asset, error };
        }
      });

      // Wait for this batch to complete
      const results = await Promise.all(downloadPromises);
      
      // Update counters
      for (const result of results) {
        totalAttemptedToProcess++;
        if (result.success) {
          totalSuccessfullyDownloaded++;
        }
        
        // Update progress (include skipped assets in total processed)
        const totalProcessed = totalAttemptedToProcess + skippableAssets.length;
      }
    }

    // Final skipped assets processing for progress
    totalSkippedAssets = skippableAssets.length;
    
    // Performance and summary reporting
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    const unprocessedCount = Object.keys(unProcessedAssets).length;

    console.log(`\n📊 Asset Download Summary:`);
    console.log(`   ${ansiColors.green('✓')} Downloaded: ${totalSuccessfullyDownloaded}`);
    console.log(`   ${ansiColors.gray('⚬')} Unchanged: ${totalSkippedAssets}`);
    if (unprocessedCount > 0) {
      console.log(`   ${ansiColors.red('✗')} Failed: ${unprocessedCount}`);
    }
    console.log(`   ⏱️  Duration: ${duration}s`);

    if (unprocessedCount > 0) {
      console.log(`\n⚠️  Unprocessed assets:`);
      Object.entries(unProcessedAssets).forEach(([id, fileName]) => {
        console.log(`   • ${fileName} (ID: ${id})`);
      });
    }

  } catch (error: any) {
    console.error('Error in downloadAllAssets:', error);
    throw error;
  }
} 
