import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getLoggerForGuid, getState, state } from "../../core/state";
import ansiColors from "ansi-colors";
import { getAllChannels } from "../shared/get-all-channels";
import * as mgmtApi from "@agility/management-sdk";

export async function downloadAllGalleries(
  guid: string,
): Promise<void> {
  const fileOps = new fileOperations(guid);
  const update = state.update; // Use state.update instead of parameter
  const apiClient = getApiClient();
  const logger = getLoggerForGuid(guid); // Use GUID-specific logger
  
  if (!logger) {
    console.warn(`⚠️  No logger found for GUID ${guid}, skipping gallery logging`);
    return;
  }
  
  logger.startTimer();
  // Helper function to get local gallery metadata
  // function getLocalGalleryInfo(filePath: string): { modifiedOn?: string; exists: boolean } {
  //   try {
  //     if (!fileOps.checkFileExists(filePath)) {
  //       return { exists: false };
  //     }
  //     const content = JSON.parse(fileOps.readFile(filePath));
  //     // Gallery files contain assetMediaGroupings arrays, find the most recent modifiedOn
  //     if (content.assetMediaGroupings && Array.isArray(content.assetMediaGroupings)) {
  //       const dates = content.assetMediaGroupings
  //         .map((g: any) => g.modifiedOn)
  //         .filter((date: any) => date)
  //         .sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime());
  //       return {
  //         modifiedOn: dates[0],
  //         exists: true
  //       };
  //     }
  //     return { exists: true };
  //   } catch (error) {
  //     return { exists: false };
  //   }
  // }

  // Helper function to check if gallery needs download based on modifiedOn date
  function shouldDownloadGallery(apiGalleries: any[], localInfo: { modifiedOn?: string; exists: boolean }): { shouldDownload: boolean; reason: string } {

    if(state.update === false){
      return { shouldDownload: false, reason: '' };
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
    let initialRecords: mgmtApi.assetGalleries;
    try {
      initialRecords = await apiClient.assetMethods.getGalleries(guid, "", 250, 0);
    } catch (error) {
      console.log("Error loading galleries:");
      console.error(error);
      return;
    }
  
    for(const gallery of initialRecords.assetMediaGroupings){
        const filename = gallery.mediaGroupingID + ".json";
        const localGallery = fileOps.readJsonFile(`galleries/${filename}`);
        if(!localGallery){
          fileOps.exportFiles("galleries", gallery.mediaGroupingID, gallery);
          logger.gallery.downloaded(gallery);
          downloadedCount++;
        } else {
          const incomingGalleryModifiedOn = new Date(gallery.modifiedOn);
          const localGalleryModifiedOn = new Date(localGallery.modifiedOn);
          if(incomingGalleryModifiedOn > localGalleryModifiedOn){
            fileOps.exportFiles("galleries", gallery.mediaGroupingID, gallery);
            logger.gallery.downloaded(gallery);
            downloadedCount++;
          } else {
            logger.gallery.skipped(gallery);
            skippedCount++;
          }
        }
 

      index++;
    }
    
    logger.endTimer();
    logger.summary("pull", downloadedCount, skippedCount, 0);

  } catch (error: any) {
    console.error(`Error in downloadAllGalleries: ${error.message}`);
    throw error;
  }
} 
