import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { fileOperations } from "../../core/fileOperations";
import { state, getApiClient } from "../../core/state";
import ansiColors from "ansi-colors";
import { ContentHashComparer } from "../shared/content-hash-comparer";
import * as path from "path";

export async function downloadAllModels(
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

  const modelsFolderPath = fileOps.getDataFolderPath('models');

  // Use fileOperations to create models folder
  fileOps.createFolder('models');

  let totalModels = 0;
  const startTime = Date.now(); // Track start time for performance measurement
  
  try {
    // Fetch both content and page models
    const contentModules = await apiClient.modelMethods.getContentModules(true, guid, false);
    const pageModules = await apiClient.modelMethods.getPageModules(true, guid);

    const allModels = [...contentModules, ...pageModules];
    totalModels = allModels.length;

    if (totalModels === 0) {
      console.log("No models found to download.");
      if (progressCallback) progressCallback(0, 0, 'success');
      return;
    }

    let processedCount = 0;
    let skippedCount = 0;
    if (progressCallback) progressCallback(0, totalModels, 'progress');

    for (let i = 0; i < allModels.length; i++) {
      const modelSummary = allModels[i];
      const fileName = modelSummary.id.toString();
      const modelFilePath = path.join(modelsFolderPath, `${fileName}.json`);
      
      try {
        // Always fetch full model details regardless of type
        const modelDetails = await apiClient.modelMethods.getContentModel(modelSummary.id, guid);
        
        if (!modelDetails) {
          throw new Error("Could not retrieve model details.");
        }
        
        const modelDisplayName = modelDetails.referenceName || modelDetails.displayName || `ID ${modelDetails.id}`;

        // Intelligent content comparison - check if content has actually changed
        // update=false (default): Use hash comparison for smart skipping (excluding dynamic fieldID values)
        // update=true: Force download/overwrite regardless of content
        if (!update) {
          const hashComparison = ContentHashComparer.getModelHashComparison(modelDetails, modelFilePath);
          
          if (hashComparison.status === 'unchanged') {
            const hashDisplay = hashComparison.shortHashes 
              ? `${ansiColors.green(`[${hashComparison.shortHashes.api}]`)}`
              : '';
            console.log(ansiColors.grey.italic('Found'), ansiColors.gray(modelDisplayName), ansiColors.grey.italic('content unchanged, skipping'), hashDisplay);
            skippedCount++;
          } else {
            // Any case that results in downloading (modified, not-exists, error)
            fileOps.exportFiles("models", fileName, modelDetails);
            
            if (hashComparison.status === 'modified') {
              const hashDisplay = hashComparison.shortHashes 
                ? `${ansiColors.red(`[${hashComparison.shortHashes.local}`)} → ${ansiColors.green(`${hashComparison.shortHashes.api}]`)}`
                : '';
              console.log(`✓ Updated model ${ansiColors.cyan(modelDisplayName)} ID: ${modelSummary.id} ${ansiColors.gray('(content changed)')} ${hashDisplay}`);
            } else if (hashComparison.status === 'not-exists') {
              const hashDisplay = hashComparison.apiHash 
                ? `${ansiColors.green(`[${hashComparison.apiHash.substring(0, 6)}]`)}`
                : '';
              console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${modelSummary.id} ${ansiColors.gray('(new file)')} ${hashDisplay}`);
            } else {
              console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${modelSummary.id} ${ansiColors.gray('(error reading local file)')}`);
            }
          }
        } else {
          // Force update mode - always download
          fileOps.exportFiles("models", fileName, modelDetails);
          console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${modelSummary.id} ${ansiColors.gray('(forced update)')}`);
        }
      } catch (itemError: any) {
        console.error(ansiColors.red(`✗ Error processing model ${modelSummary.referenceName || modelSummary.displayName || `ID ${modelSummary.id}`}: ${itemError.message}`));
      }
      
      processedCount++;
      if (progressCallback) progressCallback(processedCount, totalModels, 'progress');
    }

    // Summary of downloaded models
    const downloadedCount = processedCount - skippedCount;
    const errorCount = totalModels - processedCount;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\nDownloaded ${downloadedCount} models (${downloadedCount}/${totalModels} models, ${skippedCount} skipped, ${errorCount} errors) in ${elapsedSeconds}s\n`));
    
    if (progressCallback) progressCallback(totalModels, totalModels, 'success');
  } catch (error) {
    console.error("\nError downloading models:", error);
    if (progressCallback) progressCallback(0, totalModels, 'error');
    throw error;
  }
} 