import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { fileOperations } from "../../core/fileOperations"; // Assuming fileOperations is in services
import { state, getApiClient } from "../../core/state";
import * as fs from "fs"; // For checking if folder is empty
import * as path from "path"; // For path operations
import ansiColors from "ansi-colors";
import { ContentHashComparer } from "../shared/content-hash-comparer";

export async function downloadAllContainers(
  multibar: cliProgress.MultiBar,
  fileOps: fileOperations,
  update: boolean, // Controls whether to update existing files
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  // Get state values instead of parameters
  const guid = state.sourceGuid;
  const locale = state.locale;
  const isPreview = state.preview;
  const apiClient = getApiClient(); // Use getApiClient() instead of state.apiClient

  if (!guid) {
    throw new Error('Source GUID not available in state');
  }

  const containersFolderPath = fileOps.getDataFolderPath('containers');

  // Individual container file existence checking is now handled below

  // Use fileOperations to create containers folder
  fileOps.createFolder('containers');

  let totalContainers = 0; // Define totalContainers in a broader scope for the catch block
  const startTime = Date.now(); // Track start time for performance measurement
  try {
    // console.log("Fetching list of page templates...");
    let containers = await apiClient.containerMethods.getContainerList(guid);

    totalContainers = containers.length; // Assign here
    // console.log(`Found ${totalContainers} containers to download.`);

    if (totalContainers === 0) {
      console.log("No containers found to download.");
      if (progressCallback) progressCallback(0, 0, 'success');
      return;
    }

    let processedCount = 0;
    let skippedCount = 0;
    if (progressCallback) progressCallback(0, totalContainers, 'progress');
    // console.log("Starting download of containers...");

    for (let i = 0; i < totalContainers; i++) {
      const containerID = containers[i].contentViewID;
      const containerName = containers[i].referenceName;
      const containerFilePath = path.join(containersFolderPath, `${containerID}.json`);

      // Always fetch full container details for hash comparison
      let container = await apiClient.containerMethods.getContainerByID(containerID, guid);

      // Intelligent content comparison - check if content has actually changed
      // update=false (default): Use hash comparison for smart skipping
      // update=true: Force download/overwrite regardless of content
      if (!update) {
        const hashComparison = ContentHashComparer.getHashComparison(container, containerFilePath);
        
        if (hashComparison.status === 'unchanged') {
          const hashDisplay = hashComparison.shortHashes 
            ? `${ansiColors.green(`[${hashComparison.shortHashes.api}]`)}`
            : '';
          console.log(ansiColors.grey.italic('Found'), ansiColors.gray(`${containerName}`),ansiColors.grey.italic('content unchanged, skipping'), hashDisplay);
          skippedCount++;
        } else {
          // Any case that results in downloading (modified, not-exists, error)
          fileOps.exportFiles(`containers`, container.contentViewID, container);
          
          if (hashComparison.status === 'modified') {
            const hashDisplay = hashComparison.shortHashes 
              ? `${ansiColors.red(`[${hashComparison.shortHashes.local}`)} → ${ansiColors.green(`${hashComparison.shortHashes.api}]`)}`
              : '';
            console.log(`✓ Updated container ${ansiColors.cyan(container.referenceName)} ID: ${container.contentViewID} ${ansiColors.gray('(content changed)')} ${hashDisplay}`);
          } else if (hashComparison.status === 'not-exists') {
            const hashDisplay = hashComparison.apiHash 
              ? `${ansiColors.green(`[${hashComparison.apiHash.substring(0, 6)}]`)}`
              : '';
            console.log(`✓ Downloaded container ${ansiColors.cyan(container.referenceName)} ID: ${container.contentViewID} ${ansiColors.gray('(new file)')} ${hashDisplay}`);
          } else {
            console.log(`✓ Downloaded container ${ansiColors.cyan(container.referenceName)} ID: ${container.contentViewID} ${ansiColors.gray('(error reading local file)')}`);
          }
        }
      } else {
        // Force update mode - always download
        fileOps.exportFiles(`containers`, container.contentViewID, container);
        console.log(`✓ Downloaded container ${ansiColors.cyan(container.referenceName)} ID: ${container.contentViewID} ${ansiColors.gray('(forced update)')}`);
      }
      
      processedCount++;
      if (progressCallback) progressCallback(processedCount, totalContainers, 'progress');
    }

    // Summary of downloaded containers
    const downloadedCount = processedCount - skippedCount;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\nDownloaded ${downloadedCount} containers (${downloadedCount}/${totalContainers} containers, ${skippedCount} skipped, 0 errors) in ${elapsedSeconds}s\n`));
    // console.log("All page templates downloaded successfully.");
    if (progressCallback) progressCallback(totalContainers, totalContainers, 'success');
  } catch (error) {
    console.error("\nError downloading containers:", error);
    // Use the totalContainers variable from the outer scope
    if (progressCallback) progressCallback(0, totalContainers, 'error');
    throw error;
  }
}