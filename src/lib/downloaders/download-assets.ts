import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { fileOperations } from "../../core/fileOperations";
import { state, getApiClient } from "../../core/state";
import ansiColors from "ansi-colors";
import crypto from "crypto";
import fs from "fs";

export async function downloadAllAssets(
  multibar: cliProgress.MultiBar,
  fileOps: fileOperations, 
  update: boolean, // Controls whether to update existing files
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  // Get state values instead of parameters
  const guid = state.sourceGuid;
  const locale = state.locale;
  const isPreview = state.preview;
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
  let multiExport = false;
  let processedAssetsInLoop = 0;
  let totalSuccessfullyDownloaded = 0;
  let totalSkippedAssets = 0;
  let totalAttemptedToProcess = 0;
  let totalRecords = 0;
  const startTime = Date.now();
  let unProcessedAssets: { [key: number]: string } = {};

  try {
    let initialRecords = await apiClient.assetMethods.getMediaList(
      pageSize,
      recordOffset,
      guid
    );

    totalRecords = initialRecords.totalCount;
    if (progressCallback) progressCallback(totalSuccessfullyDownloaded, totalRecords, 'progress');

    const assetsRootWithinInstance = fileOps.getDataFolderPath("assets");
    const assetsJsonPath = fileOps.getDataFolderPath("assets/json");

    fileOps.createFolder("assets/json");

    fileOps.exportFiles(
      "assets/json",
      index,
      initialRecords
    );
    index++;

    let iterations = Math.ceil(totalRecords / pageSize);
    if (iterations === 0 && totalRecords > 0) iterations = 1;
    else if (totalRecords === 0) iterations = 0;

    if (totalRecords > pageSize) {
      multiExport = true;
    }
    
    for (let i = 0; i < initialRecords.assetMedias.length; i++) {
      totalAttemptedToProcess++;
      const assetMedia = initialRecords.assetMedias[i];
      const originUrl = assetMedia.originUrl;
      const assetMediaID = assetMedia.mediaID;
      const filePath = getFilePath(originUrl);
      const folderPath = filePath.split("/").slice(0, -1).join("/");
      let fileName = `${assetMedia.fileName}`;

      // Sanitize filename to avoid filesystem issues
      fileName = fileName.replace(/[<>:"|?*]/g, '_'); // Replace invalid filesystem characters
      fileName = fileName.substring(0, 200); // Limit filename length to prevent path issues

      const assetFolderPath = folderPath ? `assets/${folderPath}` : "assets";
      if (folderPath) {
        fileOps.createFolder(assetFolderPath);
      }
      
      const targetFilePath = fileOps.getDataFolderPath(`${assetFolderPath}/${fileName}`);
      
      // Check if we should skip file existence check based on update flag
      // update=false (default): Skip existing files, update=true: Force download/overwrite
      if (!update && fileOps.checkFileExists(targetFilePath)) {
        const fileInfo = getFileInfo(targetFilePath);
        const hashDisplay = fileInfo 
          ? `${ansiColors.green(`[${fileInfo.hash}]`)} ${ansiColors.gray(`(${formatFileSize(fileInfo.size)})`)}`
          : `${ansiColors.yellow('[no-hash]')}`;
        console.log(ansiColors.grey.italic('Found'), ansiColors.gray(fileName || originUrl.split('/').pop()),ansiColors.grey.italic('skipping download'), hashDisplay);
        totalSkippedAssets++;
      } else {
        try {
          await fileOps.downloadFile(
            originUrl,
            targetFilePath
          );
          // Get file info after download for hash display
          const fileInfo = getFileInfo(targetFilePath);
          const hashDisplay = fileInfo 
            ? `${ansiColors.green(`[${fileInfo.hash}]`)} ${ansiColors.gray(`(${formatFileSize(fileInfo.size)})`)}`
            : '';
          console.log('✓ Downloaded file', ansiColors.cyan.underline(fileName || originUrl.split('/').pop()), hashDisplay);
          totalSuccessfullyDownloaded++;
        } catch (downloadError: any) {
          console.error('✗ Failed to download file', ansiColors.red(fileName || originUrl.split('/').pop()), ansiColors.gray(downloadError.message ? `- ${downloadError.message}` : ''));
          unProcessedAssets[assetMediaID] = fileName;
        }
      }
      const processedAssets = totalSuccessfullyDownloaded + totalSkippedAssets;
      if (progressCallback) progressCallback(processedAssets, totalRecords, 'progress');
    }

    if (multiExport) {
      for (let iter = 1; iter < iterations; iter++) { 
        recordOffset += pageSize;
        processedAssetsInLoop = 0;

        let assetsPage = await apiClient.assetMethods.getMediaList(
          pageSize,
          recordOffset,
          guid
        );
        fileOps.exportFiles(
          "assets/json",
          index,
          assetsPage
        );
        index++;

        for (let j = 0; j < assetsPage.assetMedias.length; j++) {
          totalAttemptedToProcess++;
          const assetMedia = assetsPage.assetMedias[j];
          const originUrl = assetMedia.originUrl;
          const mediaID = assetMedia.mediaID;
          const filePath = getFilePath(originUrl);
          const folderPath = filePath.split("/").slice(0, -1).join("/");
          let fileName = `${assetMedia.fileName}`;

          // Sanitize filename to avoid filesystem issues
          fileName = fileName.replace(/[<>:"|?*]/g, '_'); // Replace invalid filesystem characters
          fileName = fileName.substring(0, 200); // Limit filename length to prevent path issues

          const assetFolderPath = folderPath ? `assets/${folderPath}` : "assets";
          if (folderPath) {
            fileOps.createFolder(assetFolderPath);
          }

          const targetFilePath = fileOps.getDataFolderPath(`${assetFolderPath}/${fileName}`);
          
          // Check if we should skip file existence check based on update flag
          // update=false (default): Skip existing files, update=true: Force download/overwrite
          if (!update && fileOps.checkFileExists(targetFilePath)) {
            const fileInfo = getFileInfo(targetFilePath);
            const hashDisplay = fileInfo 
              ? `${ansiColors.green(`[${fileInfo.hash}]`)} ${ansiColors.gray(`(${formatFileSize(fileInfo.size)})`)}`
              : `${ansiColors.yellow('[no-hash]')}`;
            console.log(ansiColors.grey.italic('Found'), ansiColors.gray(fileName || originUrl.split('/').pop()),ansiColors.grey.italic('skipping download'), hashDisplay);
            totalSkippedAssets++;
          } else {
            try {
              await fileOps.downloadFile(
                originUrl,
                targetFilePath
              );
              // Get file info after download for hash display
              const fileInfo = getFileInfo(targetFilePath);
              const hashDisplay = fileInfo 
                ? `${ansiColors.green(`[${fileInfo.hash}]`)} ${ansiColors.gray(`(${formatFileSize(fileInfo.size)})`)}`
                : '';
              console.log('✓ Downloaded file', ansiColors.cyan.underline(fileName || originUrl.split('/').pop()), hashDisplay);
              totalSuccessfullyDownloaded++;
            } catch (downloadError: any) {
              console.error('✗ Failed to download file', ansiColors.red(fileName || originUrl.split('/').pop()), ansiColors.gray(downloadError.message ? `- ${downloadError.message}` : ''));
              unProcessedAssets[mediaID] = fileName;
            }
          }
          const processedAssets = totalSuccessfullyDownloaded + totalSkippedAssets;
          if (progressCallback) progressCallback(processedAssets, totalRecords, 'progress');
        }
      }
    }

    // Final summary
    const processedAssets = totalSuccessfullyDownloaded + totalSkippedAssets;
    const errorCount = totalAttemptedToProcess - processedAssets;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    const summaryMessage = `\nDownloaded ${totalSuccessfullyDownloaded} assets (${totalSuccessfullyDownloaded}/${totalAttemptedToProcess} assets, ${totalSkippedAssets} skipped, ${errorCount} errors) in ${elapsedSeconds}s\n`;
    
    console.log(ansiColors.yellow(summaryMessage));
    
    if (progressCallback) progressCallback(processedAssets, totalRecords, processedAssets === totalAttemptedToProcess && totalAttemptedToProcess >= totalRecords ? 'success' : 'error');
  } catch (error) {
    const processedAssets = totalSuccessfullyDownloaded + totalSkippedAssets;
    const errorCount = totalAttemptedToProcess - processedAssets;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    const summaryMessage = `\nDownloaded ${totalSuccessfullyDownloaded} assets (${totalSuccessfullyDownloaded}/${totalAttemptedToProcess} assets, ${totalSkippedAssets} skipped, ${errorCount} errors) in ${elapsedSeconds}s\n`;
    
    console.log(ansiColors.yellow(summaryMessage));
    
    if (progressCallback) progressCallback(processedAssets, totalRecords, 'error');
    throw error;
  }
} 