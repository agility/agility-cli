import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState } from "../../core/state";
import * as path from "path";
import ansiColors from "ansi-colors";
import { ContentHashComparer } from "../shared/content-hash-comparer";

export async function downloadAllContainers(
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

  const containersFolderPath = fileOps.getDataFolderPath('containers');

  // Use fileOperations to create containers folder
  fileOps.createFolder('containers');

  let totalContainers = 0; // Define totalContainers in a broader scope for the catch block
  const startTime = Date.now(); // Track start time for performance measurement
  
  try {
    // Phase 1: Collect all container metadata
    console.log("📋 Fetching container list from API...");
    let containers = await apiClient.containerMethods.getContainerList(guid);

    totalContainers = containers.length;
    console.log(`📦 Found ${totalContainers} containers. Starting concurrent downloads...`);

    if (totalContainers === 0) {
      console.log("No containers found to download.");
      if (progressCallback) progressCallback(0, 0, 'success');
      return;
    }

    if (progressCallback) progressCallback(0, totalContainers, 'progress');

    // Phase 2: Prepare download tasks for concurrent execution
    interface ContainerDownloadTask {
      containerID: string;
      containerName: string;
      containerFilePath: string;
      shouldDownload: boolean;
    }

    const downloadTasks: ContainerDownloadTask[] = [];

    // Prepare all download tasks
    for (const containerRef of containers) {
      const containerID = containerRef.contentViewID.toString();
      const containerName = containerRef.referenceName;
      const containerFilePath = path.join(containersFolderPath, `${containerID}.json`);

      // For containers, we need to fetch the full container details to do hash comparison
      // So we'll handle the "should download" logic during execution
      downloadTasks.push({
        containerID,
        containerName,
        containerFilePath,
        shouldDownload: true // We'll determine this during execution
      });
    }

    // Phase 3: Execute container downloads concurrently in batches
    const CONCURRENT_BATCH_SIZE = 20; // Download max 5 containers at once (lower than assets since containers are more complex)
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
      console.log(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} containers)...`);
      
      // Create download promises for this batch
      const downloadPromises = batch.map(async (task) => {
        try {
          // Always fetch full container details for hash comparison
          const container = await apiClient.containerMethods.getContainerByID(task.containerID, guid);

          // Intelligent content comparison - check if content has actually changed
          // update=false (default): Use hash comparison for smart skipping
          // update=true: Force download/overwrite regardless of content
          if (!update) {
            const hashComparison = ContentHashComparer.getHashComparison(container, task.containerFilePath);
            
            if (hashComparison.status === 'unchanged') {
              const hashDisplay = hashComparison.shortHashes 
                ? `${ansiColors.green(`[${hashComparison.shortHashes.api}]`)}`
                : '';
              console.log(ansiColors.grey.italic('Found'), ansiColors.gray(`${task.containerName}`), ansiColors.grey.italic('content unchanged, skipping'), hashDisplay);
              return { success: true, task, skipped: true };
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
              return { success: true, task, skipped: false };
            }
          } else {
            // Force update mode - always download
            fileOps.exportFiles(`containers`, container.contentViewID, container);
            console.log(`✓ Downloaded container ${ansiColors.cyan(container.referenceName)} ID: ${container.contentViewID} ${ansiColors.gray('(forced update)')}`);
            return { success: true, task, skipped: false };
          }
        } catch (error: any) {
          console.error(`✗ Failed to download container ${ansiColors.red(task.containerName)} ID: ${task.containerID}`, ansiColors.gray(error.message ? `- ${error.message}` : ''));
          return { success: false, task, error };
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
      if (progressCallback) progressCallback(processedCount, totalContainers, 'progress');
    }

    // Final summary
    const errorCount = totalContainers - processedCount;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\n🎉 Container download completed: ${downloadedCount} downloaded, ${skippedCount} skipped, ${errorCount} errors (${elapsedSeconds}s)\n`));
    
    if (progressCallback) progressCallback(totalContainers, totalContainers, 'success');
  } catch (error) {
    console.error("\nError downloading containers:", error);
    // Use the totalContainers variable from the outer scope
    if (progressCallback) progressCallback(0, totalContainers, 'error');
    throw error;
  }
}