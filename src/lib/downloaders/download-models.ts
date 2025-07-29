import { fileOperations } from "core/fileOperations";
import { getApiClient, getLoggerForGuid, getState, state } from "core/state";
import * as path from "path";
import * as fs from "fs";
import { getAllChannels } from "lib/shared/get-all-channels";

export async function downloadAllModels(
  guid: string,
): Promise<void> {
  // Get values from fileOps which is already configured for this specific GUID/locale
  const fileOps = new fileOperations(guid);
  const apiClient = getApiClient();
  const logger = getLoggerForGuid(guid);
  logger.startTimer();

  const modelsFolderPath = fileOps.getDataFolderPath('models');
  // Use fileOperations to create models folder
  fileOps.createFolder('models');

  let totalModels = 0;
  
  // Helper function to get local model metadata
  function getLocalModelInfo(filePath: string): { lastModifiedDate?: string; exists: boolean } {
    try {
      if (!fs.existsSync(filePath)) {
        return { exists: false };
      }
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        lastModifiedDate: content.lastModifiedDate,
        exists: true
      };
    } catch (error) {
      return { exists: false };
    }
  }

  // Helper function to check if model needs download based on lastModifiedDate
  function shouldDownloadModel(apiModel: any, localInfo: { lastModifiedDate?: string; exists: boolean }): { shouldDownload: boolean; reason: string } {
    
    if (state.update === false){
      return { shouldDownload: false, reason: '' };
    }

    if (!localInfo.exists) {
      return { shouldDownload: true, reason: 'new file' };
    }

    if (!localInfo.lastModifiedDate || !apiModel.lastModifiedDate) {
      return { shouldDownload: true, reason: 'missing date info' };
    }

    const apiDate = new Date(apiModel.lastModifiedDate);
    const localDate = new Date(localInfo.lastModifiedDate);

    if (apiDate > localDate) {
      return { shouldDownload: true, reason: 'content changed' };
    }

    return { shouldDownload: false, reason: 'unchanged' };
  }
  
  try {
    // Phase 1: Collect all model metadata
    const contentModules = await apiClient.modelMethods.getContentModules(false, guid, false);
    const pageModules = await apiClient.modelMethods.getPageModules(false, guid);

    const allModels = [...contentModules, ...pageModules];
    totalModels = allModels.length;
    
    const downloadableModels = [];
    const skippableModels = [];

    for (let i = 0; i < allModels.length; i++) {
      const modelSummary = allModels[i];
      const fileName = modelSummary.id.toString();
      const modelFilePath = path.join(modelsFolderPath, `${fileName}.json`);
      
      // Determine model type based on which array it came from
      const modelType = i < contentModules.length ? 'content' : 'page';
      
      // Get local model info for comparison
      const localInfo = getLocalModelInfo(modelFilePath);
      const downloadDecision = shouldDownloadModel(modelSummary, localInfo);
      
      if (downloadDecision.shouldDownload) {
        downloadableModels.push({ 
          modelSummary, 
          fileName, 
          modelType, 
          reason: downloadDecision.reason 
        });
      } else {
        skippableModels.push({ 
          modelSummary, 
          fileName, 
          modelType, 
          reason: downloadDecision.reason 
        });
        

      }
    }

    if(skippableModels.length > 0){
      logger.changeDetectionSummary("model", downloadableModels.length, skippableModels.length);
    }

    // Phase 3: Download only the models that need updating
    if (downloadableModels.length === 0) {
      return;
    }

    // Execute model downloads concurrently in batches
    const CONCURRENT_BATCH_SIZE = 20; // Download max 20 models at once
    const batches = [];
    
    for (let i = 0; i < downloadableModels.length; i += CONCURRENT_BATCH_SIZE) {
      batches.push(downloadableModels.slice(i, i + CONCURRENT_BATCH_SIZE));
    }

    let processedCount = 0;
    let downloadedCount = 0;
    let skippedCount = skippableModels.length;

    // Process each batch concurrently
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      // Create download promises for this batch
      const downloadPromises = batch.map(async (item) => {
        const { modelSummary, fileName, modelType, reason } = item;
        try {
          // Always fetch full model details regardless of type
          const modelDetails = await apiClient.modelMethods.getContentModel(modelSummary.id, guid);
          
          if (!modelDetails) {
            throw new Error("Could not retrieve model details.");
          }
          // Export model JSON
          fileOps.exportFiles(`models`, fileName, modelDetails);
          logger.model.downloaded(modelDetails);  
          return { success: true, modelDetails };
        } catch (error: any) {
          logger.model.error(item, error);
          return { success: false, modelSummary, error };
        }
      });

      // Wait for this batch to complete
      const results = await Promise.all(downloadPromises);
      
      // Update counters
      for (const result of results) {
        processedCount++;
        if (result.success) {
          downloadedCount++;
        }
      }
    }

    logger.endTimer();
    logger.summary("pull", downloadedCount, 0, 0);

  } catch (error: any) {
    logger.error("Error in downloadAllModels:", error);
    throw error;
  }
} 
