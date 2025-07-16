import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState } from "../../core/state";
import ansiColors from "ansi-colors";
import { SyncDeltaTracker } from "../shared/sync-delta-tracker";
import * as path from "path";
import * as fs from "fs";

export async function downloadAllModels(
  fileOps: fileOperations,
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void,
  syncDeltaTracker?: SyncDeltaTracker
): Promise<void> {
  // Get values from fileOps which is already configured for this specific GUID/locale
  const guid = fileOps.guid;
  const update = getState().update; // Use state.update instead of parameter
  const apiClient = getApiClient();

  if (!guid) {
    throw new Error('Source GUID not available in state');
  }

  const modelsFolderPath = fileOps.getDataFolderPath('models');

  // Use fileOperations to create models folder
  fileOps.createFolder('models');

  let totalModels = 0;
  const startTime = Date.now(); // Track start time for performance measurement
  
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
    if (update) {
      return { shouldDownload: true, reason: 'forced update' };
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
    const contentModules = await apiClient.modelMethods.getContentModules(true, guid, false);
    const pageModules = await apiClient.modelMethods.getPageModules(true, guid);

    const allModels = [...contentModules, ...pageModules];
    totalModels = allModels.length;
    
    if (totalModels === 0) {
      if (progressCallback) progressCallback(0, 0, 'success');
      return;
    }

    if (progressCallback) progressCallback(0, totalModels, 'progress');

    // Phase 2: Analyze which models need downloading
    // console.log(`\n📥 Processing ${totalModels} models with smart change detection...`);

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
        
        // Record unchanged model in sync delta
        if (syncDeltaTracker) {
          syncDeltaTracker.recordChange({
            id: modelSummary.id,
            type: 'model',
            action: 'unchanged',
            name: modelSummary.referenceName || modelSummary.displayName,
            referenceName: modelSummary.referenceName,
            timestamp: '' // Will be overridden by recordChange
          });
        }
      }
    }

    console.log(`Model Change Detection Results: ${ansiColors.green(downloadableModels.length.toString())} to download, ${ansiColors.gray(skippableModels.length.toString())} unchanged`);

    // Phase 3: Download only the models that need updating
    if (downloadableModels.length === 0) {
      // console.log("✅ All models are up to date!");
      if (progressCallback) progressCallback(totalModels, totalModels, 'success');
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
          
          const modelDisplayName = modelDetails.referenceName || modelDetails.displayName || `ID ${modelDetails.id}`;

          // Export model JSON
          fileOps.exportFiles(`models`, fileName, modelDetails);
          console.log(`✓ Downloaded ${modelType} model ${ansiColors.cyan(modelDisplayName)} ${ansiColors.gray(`(${reason})`)}`);
          
          // Record successful download in sync delta
          if (syncDeltaTracker) {
            syncDeltaTracker.recordChange({
              id: modelDetails.id,
              type: 'model',
              action: reason === 'new file' ? 'created' : 'updated',
              name: modelDisplayName,
              referenceName: modelDetails.referenceName,
              timestamp: '' // Will be overridden by recordChange
            });
          }
          
          return { success: true, modelDetails };
        } catch (error: any) {
          const modelDisplayName = modelSummary.referenceName || modelSummary.displayName || `ID ${modelSummary.id}`;
          console.error(`✗ Failed to download ${modelType} model ${ansiColors.red(modelDisplayName)}:`, ansiColors.gray(error.message || 'Unknown error'));
          
          // Record error in sync delta
          if (syncDeltaTracker) {
            syncDeltaTracker.recordChange({
              id: modelSummary.id,
              type: 'model',
              action: 'error',
              name: modelDisplayName,
              referenceName: modelSummary.referenceName,
              timestamp: '' // Will be overridden by recordChange
            });
          }
          
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
        
        // Update progress (include skipped models in total processed)
        const totalProcessed = processedCount + skippedCount;
        if (progressCallback) {
          progressCallback(totalProcessed, totalModels, result.success ? 'success' : 'error');
        }
      }
    }

    // Performance and summary reporting
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    const errorCount = downloadableModels.length - downloadedCount;

    console.log(`\nModel Download Summary:`);
    console.log(`   ${ansiColors.green('✓')} Downloaded: ${downloadedCount}`);
    // console.log(`   ${ansiColors.gray('⚬')} Unchanged: ${skippedCount}`);
    if (errorCount > 0) {
      console.log(`   ${ansiColors.red('✗')} Failed: ${errorCount}`);
    }
    // console.log(`   ⏱️  Duration: ${duration}s`);

  } catch (error: any) {
    console.error('Error in downloadAllModels:', error);
    throw error;
  }
} 