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

  let index = 0;
  let skippedCount = 0;
  let downloadedCount = 0;

  fileOps.createFolder("galleries");

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
