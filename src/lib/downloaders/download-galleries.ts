import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState, state } from "../../core/state";
import ansiColors from "ansi-colors";
import { SyncDelta } from "../shared/sync-delta-tracker";
import * as fs from "fs";
import * as path from "path";
import { getAllChannels } from "../shared/get-all-channels";

export async function downloadAllGalleries(
  guid: string
): Promise<void> {
  const fileOps = new fileOperations(guid);
  const update = state.update; // Use state.update instead of parameter
  const apiClient = getApiClient();
  
  // Create SyncDeltaTracker internally
  const syncDelta = new SyncDelta(guid);

  // Helper function to get local gallery metadata
  function getLocalGalleryInfo(filePath: string): { modifiedOn?: string; exists: boolean } {
    try {
      if (!fs.existsSync(filePath)) {
        return { exists: false };
      }
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // Gallery files contain assetMediaGroupings arrays, find the most recent modifiedOn
      if (content.assetMediaGroupings && Array.isArray(content.assetMediaGroupings)) {
        const dates = content.assetMediaGroupings
          .map((g: any) => g.modifiedOn)
          .filter((date: any) => date)
          .sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime());
        return {
          modifiedOn: dates[0],
          exists: true
        };
      }
      return { exists: true };
    } catch (error) {
      return { exists: false };
    }
  }

  // Helper function to check if gallery needs download based on modifiedOn date
  function shouldDownloadGallery(apiGalleries: any[], localInfo: { modifiedOn?: string; exists: boolean }): { shouldDownload: boolean; reason: string } {
    if (update) {
      return { shouldDownload: true, reason: 'forced update' };
    }

    if (!localInfo.exists) {
      return { shouldDownload: true, reason: 'new file' };
    }

    if (!localInfo.modifiedOn || !apiGalleries || apiGalleries.length === 0) {
      return { shouldDownload: true, reason: 'missing date info' };
    }

    // Find the most recent modifiedOn date from API galleries
    const apiDates = apiGalleries
      .map((g: any) => g.modifiedOn)
      .filter((date: any) => date)
      .sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime());

    if (apiDates.length === 0) {
      return { shouldDownload: false, reason: 'unchanged' };
    }

    const apiDate = new Date(apiDates[0]);
    const localDate = new Date(localInfo.modifiedOn);

    if (apiDate > localDate) {
      return { shouldDownload: true, reason: 'content changed' };
    }

    return { shouldDownload: false, reason: 'unchanged' };
  }

  let index = 0;
  let skippedCount = 0;
  let downloadedCount = 0;

  try {
    let initialRecords;
    try {
      initialRecords = await apiClient.assetMethods.getGalleries(guid, "", 250, 0);
    } catch (error) {
      console.log("Error loading galleries:");
      console.error(error);
      return;
    }

    fileOps.createFolder("assets/galleries");
    
    // Process initial records
    const initialFilePath = fileOps.getDataFolderPath(`assets/galleries/${index}.json`);
    const localInfo = getLocalGalleryInfo(initialFilePath);
    const downloadDecision = shouldDownloadGallery(initialRecords.assetMediaGroupings, localInfo);
    
    if (downloadDecision.shouldDownload) {
      fileOps.exportFiles("assets/galleries", index, initialRecords);
      console.log(`✓ Downloaded galleries-${index}.json ${ansiColors.gray(`(${downloadDecision.reason})`)}`);
      downloadedCount++;
      
      // Record in sync delta
      if (syncDelta) {
        syncDelta.recordChange({
          id: index,
          type: 'gallery',
          action: downloadDecision.reason === 'new file' ? 'created' : 'updated',
          name: `galleries-${index}.json`,
          referenceName: `galleries-${index}`,
        });
      }
    } else {
      console.log(`✓ Gallery file galleries-${index}.json up to date, skipping`);
      skippedCount++;
    }

    index++;

    // Process remaining records in batches
    for (let rowIndex = 500; rowIndex < initialRecords.totalCount; rowIndex += 500) {
      const galleries = await apiClient.assetMethods.getGalleries(
        guid,
        "",
        500,
        rowIndex
      );

      const galleryFilePath = fileOps.getDataFolderPath(`assets/galleries/${index}.json`);
      const localGalleryInfo = getLocalGalleryInfo(galleryFilePath);
      const galleryDownloadDecision = shouldDownloadGallery(galleries.assetMediaGroupings, localGalleryInfo);
      
      if (galleryDownloadDecision.shouldDownload) {
        fileOps.exportFiles("assets/galleries", index, galleries);
        console.log(`✓ Downloaded galleries-${index}.json ${ansiColors.gray(`(${galleryDownloadDecision.reason})`)}`);
        downloadedCount++;
        
        // Record in sync delta
        if (syncDelta) {
          syncDelta.recordChange({
            id: index,
            type: 'gallery',
            action: galleryDownloadDecision.reason === 'new file' ? 'created' : 'updated',
            name: `galleries-${index}.json`,
            referenceName: `galleries-${index}`,
          });
        }
      } else {
        console.log(ansiColors.yellow(`✓ Gallery file galleries-${index}.json up to date, skipping`));
        skippedCount++;
      }

      index++;
    }

    console.log(`\nGallery Change Detection Results: ${ansiColors.green(downloadedCount.toString())} to download, ${ansiColors.gray(skippedCount.toString())} unchanged`);

  } catch (error: any) {
    console.error(`Error in downloadAllGalleries: ${error.message}`);
    throw error;
  }
} 
