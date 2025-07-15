import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState } from "../../core/state";
import ansiColors from "ansi-colors";
import { ContentHashComparer } from "../shared/content-hash-comparer";
import * as path from "path";

export async function downloadAllModels(
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

  const modelsFolderPath = fileOps.getDataFolderPath('models');

  // Use fileOperations to create models folder
  fileOps.createFolder('models');

  let totalModels = 0;
  const startTime = Date.now(); // Track start time for performance measurement
  
  try {
    // Phase 1: Collect all model metadata
    console.log("📋 Fetching models list from API...");
    const contentModules = await apiClient.modelMethods.getContentModules(true, guid, false);
    const pageModules = await apiClient.modelMethods.getPageModules(true, guid);

    const allModels = [...contentModules, ...pageModules];
    totalModels = allModels.length;
    console.log(`📦 Found ${totalModels} models (${contentModules.length} content, ${pageModules.length} page). Starting concurrent downloads...`);

    if (totalModels === 0) {
      console.log("No models found to download.");
      if (progressCallback) progressCallback(0, 0, 'success');
      return;
    }

    if (progressCallback) progressCallback(0, totalModels, 'progress');

    // Phase 2: Prepare download tasks for concurrent execution
    interface ModelDownloadTask {
      modelSummary: any;
      fileName: string;
      modelFilePath: string;
      modelType: 'content' | 'page';
    }

    const downloadTasks: ModelDownloadTask[] = [];

    // Prepare all download tasks
    for (let i = 0; i < allModels.length; i++) {
      const modelSummary = allModels[i];
      const fileName = modelSummary.id.toString();
      const modelFilePath = path.join(modelsFolderPath, `${fileName}.json`);
      
      // Determine model type based on which array it came from
      const modelType = i < contentModules.length ? 'content' : 'page';
      
      downloadTasks.push({
        modelSummary,
        fileName,
        modelFilePath,
        modelType
      });
    }

    // Phase 3: Execute model downloads concurrently in batches
    const CONCURRENT_BATCH_SIZE = 20; // Download max 5 models at once (same as containers)
    const batches = [];
    
    for (let i = 0; i < downloadTasks.length; i += CONCURRENT_BATCH_SIZE) {
      batches.push(downloadTasks.slice(i, i + CONCURRENT_BATCH_SIZE));
    }

    let processedCount = 0;
    let downloadedCount = 0;
    let skippedCount = 0;

    // Process each batch concurrently
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      // Create download promises for this batch
      const downloadPromises = batch.map(async (task) => {
        try {
          // Always fetch full model details regardless of type
          const modelDetails = await apiClient.modelMethods.getContentModel(task.modelSummary.id, guid);
          
          if (!modelDetails) {
            throw new Error("Could not retrieve model details.");
          }
          
          const modelDisplayName = modelDetails.referenceName || modelDetails.displayName || `ID ${modelDetails.id}`;

          // Intelligent content comparison - check if content has actually changed
          // update=false (default): Use hash comparison for smart skipping (excluding dynamic fieldID values)
          // update=true: Force download/overwrite regardless of content
          if (!update) {
            const hashComparison = ContentHashComparer.getModelHashComparison(modelDetails, task.modelFilePath);
            
            if (hashComparison.status === 'unchanged') {
              const hashDisplay = hashComparison.shortHashes 
                ? `${ansiColors.green(`[${hashComparison.shortHashes.api}]`)}`
                : '';
              console.log(ansiColors.grey.italic('Found'), ansiColors.gray(modelDisplayName), ansiColors.grey.italic('content unchanged, skipping'), hashDisplay);
              return { success: true, task, skipped: true };
            } else {
              // Any case that results in downloading (modified, not-exists, error)
              fileOps.exportFiles("models", task.fileName, modelDetails);
              
              if (hashComparison.status === 'modified') {
                const hashDisplay = hashComparison.shortHashes 
                  ? `${ansiColors.red(`[${hashComparison.shortHashes.local}`)} → ${ansiColors.green(`${hashComparison.shortHashes.api}]`)}`
                  : '';
                console.log(`✓ Updated model ${ansiColors.cyan(modelDisplayName)} ID: ${task.modelSummary.id} ${ansiColors.gray('(content changed)')} ${hashDisplay}`);
              } else if (hashComparison.status === 'not-exists') {
                const hashDisplay = hashComparison.apiHash 
                  ? `${ansiColors.green(`[${hashComparison.apiHash.substring(0, 6)}]`)}`
                  : '';
                console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${task.modelSummary.id} ${ansiColors.gray('(new file)')} ${hashDisplay}`);
              } else {
                console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${task.modelSummary.id} ${ansiColors.gray('(error reading local file)')}`);
              }
              return { success: true, task, skipped: false };
            }
          } else {
            // Force update mode - always download
            fileOps.exportFiles("models", task.fileName, modelDetails);
            console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${task.modelSummary.id} ${ansiColors.gray('(forced update)')}`);
            return { success: true, task, skipped: false };
          }
        } catch (itemError: any) {
          console.error(ansiColors.red(`✗ Error processing model ${task.modelSummary.referenceName || task.modelSummary.displayName || `ID ${task.modelSummary.id}`}: ${itemError.message}`));
          return { success: false, task, error: itemError };
        }
      });

      // Wait for this batch to complete
      const results = await Promise.allSettled(downloadPromises);
      
      // Count results
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          processedCount++;
          if (result.value.success) {
            if (result.value.skipped) {
              skippedCount++;
            } else {
              downloadedCount++;
            }
          }
        } else {
          processedCount++;
        }
      });

      // Update progress after each batch
      if (progressCallback) progressCallback(processedCount, totalModels, 'progress');
    }

    // Final summary
    const errorCount = totalModels - processedCount;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\n🎉 Model download completed: ${downloadedCount} downloaded, ${skippedCount} skipped, ${errorCount} errors (${elapsedSeconds}s)\n`));
    
    if (progressCallback) progressCallback(totalModels, totalModels, 'success');
  } catch (error) {
    console.error("\nError downloading models:", error);
    if (progressCallback) progressCallback(0, totalModels, 'error');
    throw error;
  }
} 