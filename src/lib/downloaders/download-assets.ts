import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState } from "../../core/state";
import ansiColors from "ansi-colors";
import crypto from "crypto";
import fs from "fs";

export async function downloadAllAssets(
  fileOps: fileOperations, 
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  // Get values from fileOps which is already configured for this specific GUID/locale
  const guid = fileOps.guid;
  const update = getState().update; // Use state.update instead of parameter
  const apiClient = getApiClient();

  if (!guid) {
    throw new Error('Source GUID not available in state');
  }

  // Helper function to extract file path from origin URL
  function getFilePath(originUrl: string): string {
    let url = new URL(originUrl);
    let pathName = url.pathname;
    let extractedStr = pathName.split("/")[1];
    let removedStr = pathName.replace(`/${extractedStr}/`, "");
    return removedStr;
  }

  // Helper function to get file info (hash and size)
  function getFileInfo(filePath: string): { size: number; hash: string } | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      return {
        size: stats.size,
        hash: hash.substring(0, 6) // Show first 6 characters of hash
      };
    } catch (error) {
      return null;
    }
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
    console.log(`📋 Fetching asset metadata from API...`);
    
    // Phase 1: Collect all asset metadata from all pages
    let allAssets: any[] = [];
    let initialRecords = await apiClient.assetMethods.getMediaList(
      pageSize,
      recordOffset,
      guid
    );

    totalRecords = initialRecords.totalCount;
    if (progressCallback) progressCallback(0, totalRecords, 'progress');

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
        
        // Export JSON for this page
        fileOps.exportFiles("assets/json", index, assetsPage);
        allAssets.push(...assetsPage.assetMedias);
        index++;
      }
    }

    console.log(`📦 Collected ${allAssets.length} assets. Starting concurrent downloads...`);

    // Phase 2: Prepare download tasks for concurrent execution
    interface AssetDownloadTask {
      assetMedia: any;
      targetFilePath: string;
      fileName: string;
      shouldDownload: boolean;
    }

    const downloadTasks: AssetDownloadTask[] = [];

    // Prepare all download tasks
    for (const assetMedia of allAssets) {
      totalAttemptedToProcess++;
      const originUrl = assetMedia.originUrl;
      const filePath = getFilePath(originUrl);
      const folderPath = filePath.split("/").slice(0, -1).join("/");
      let fileName = `${assetMedia.fileName}`;

      // Sanitize filename to avoid filesystem issues
      fileName = fileName.replace(/[<>:"|?*]/g, '_');
      fileName = fileName.substring(0, 200);

      const assetFolderPath = folderPath ? `assets/${folderPath}` : "assets";
      if (folderPath) {
        fileOps.createFolder(assetFolderPath);
      }
      
      const targetFilePath = fileOps.getDataFolderPath(`${assetFolderPath}/${fileName}`);
      
      // Check if we should download this file
      const shouldDownload = update || !fileOps.checkFileExists(targetFilePath);
      
      if (!shouldDownload) {
        const fileInfo = getFileInfo(targetFilePath);
        const hashDisplay = fileInfo 
          ? `${ansiColors.green(`[${fileInfo.hash}]`)} ${ansiColors.gray(`(${formatFileSize(fileInfo.size)})`)}`
          : `${ansiColors.yellow('[no-hash]')}`;
        console.log(ansiColors.grey.italic('Found'), ansiColors.gray(fileName || originUrl.split('/').pop()),ansiColors.grey.italic('skipping download'), hashDisplay);
        totalSkippedAssets++;
      }

      downloadTasks.push({
        assetMedia,
        targetFilePath,
        fileName,
        shouldDownload
      });
    }

    // Phase 3: Execute downloads concurrently (only for files that need downloading)
    const filesToDownload = downloadTasks.filter(task => task.shouldDownload);
    
    if (filesToDownload.length > 0) {
      console.log(`⚡ Downloading ${filesToDownload.length} files concurrently...`);
      
      // Download files in batches to avoid overwhelming the server
      const CONCURRENT_BATCH_SIZE = 20; // Download max 10 files at once
      const batches = [];
      
      for (let i = 0; i < filesToDownload.length; i += CONCURRENT_BATCH_SIZE) {
        batches.push(filesToDownload.slice(i, i + CONCURRENT_BATCH_SIZE));
      }

      // Process each batch concurrently
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        // Create download promises for this batch
        const downloadPromises = batch.map(async (task) => {
          try {
            await fileOps.downloadFile(task.assetMedia.originUrl, task.targetFilePath);
            
            // Get file info after download for hash display
            const fileInfo = getFileInfo(task.targetFilePath);
            const hashDisplay = fileInfo 
              ? `${ansiColors.green(`[${fileInfo.hash}]`)} ${ansiColors.gray(`(${formatFileSize(fileInfo.size)})`)}`
              : '';
            console.log('✓ Downloaded file', ansiColors.cyan.underline(task.fileName || task.assetMedia.originUrl.split('/').pop()), hashDisplay);
            return { success: true, task };
          } catch (downloadError: any) {
            console.error('✗ Failed to download file', ansiColors.red(task.fileName || task.assetMedia.originUrl.split('/').pop()), ansiColors.gray(downloadError.message ? `- ${downloadError.message}` : ''));
            unProcessedAssets[task.assetMedia.mediaID] = task.fileName;
            return { success: false, task, error: downloadError };
          }
        });

        // Wait for this batch to complete
        const results = await Promise.allSettled(downloadPromises);
        
        // Count results
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value.success) {
            totalSuccessfullyDownloaded++;
          }
        });

        // Update progress after each batch
        const processedAssets = totalSuccessfullyDownloaded + totalSkippedAssets;
        if (progressCallback) progressCallback(processedAssets, totalRecords, 'progress');
      }
    }

    // Final summary
    const processedAssets = totalSuccessfullyDownloaded + totalSkippedAssets;
    const errorCount = totalAttemptedToProcess - processedAssets;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    const summaryMessage = `\n🎉 Asset download completed: ${totalSuccessfullyDownloaded} downloaded, ${totalSkippedAssets} skipped, ${errorCount} errors (${elapsedSeconds}s)\n`;
    
    console.log(ansiColors.green(summaryMessage));
    
    if (progressCallback) progressCallback(processedAssets, totalRecords, processedAssets === totalAttemptedToProcess && totalAttemptedToProcess >= totalRecords ? 'success' : 'error');
  } catch (error) {
    const processedAssets = totalSuccessfullyDownloaded + totalSkippedAssets;
    const errorCount = totalAttemptedToProcess - processedAssets;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    const summaryMessage = `\n❌ Asset download error: ${totalSuccessfullyDownloaded} downloaded, ${totalSkippedAssets} skipped, ${errorCount} errors (${elapsedSeconds}s)\n`;
    
    console.log(ansiColors.red(summaryMessage));
    
    if (progressCallback) progressCallback(processedAssets, totalRecords, 'error');
    throw error;
  }
} 