import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState, state } from "../../core/state";
import * as path from "path";
import ansiColors from "ansi-colors";
import { SyncDeltaTracker } from "../shared/sync-delta-tracker";
import * as fs from "fs";
import { getAllChannels } from "../shared/get-all-channels";

export async function downloadAllContainers(
  guid: string
): Promise<void> {
  const fileOps = new fileOperations(guid);
  const update = state.update; // Use state.update instead of parameter
  const apiClient = getApiClient();

  // Create SyncDeltaTracker internally
  const syncDeltaTracker = new SyncDeltaTracker(guid);

  const containersFolderPath = fileOps.getDataFolderPath('containers');

  // Use fileOperations to create containers folder
  fileOps.createFolder('containers');

  let totalContainers = 0; // Define totalContainers in a broader scope for the catch block
  const startTime = Date.now(); // Track start time for performance measurement
  
  // Helper function to get local container metadata
  function getLocalContainerInfo(filePath: string): { lastModifiedDate?: string; exists: boolean } {
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

  // Helper function to check if container needs download based on lastModifiedDate
  function shouldDownloadContainer(apiContainer: any, localInfo: { lastModifiedDate?: string; exists: boolean }): { shouldDownload: boolean; reason: string } {
    if (update) {
      return { shouldDownload: true, reason: 'forced update' };
    }

    if (!localInfo.exists) {
      return { shouldDownload: true, reason: 'new file' };
    }

    if (!localInfo.lastModifiedDate || !apiContainer.lastModifiedDate) {
      return { shouldDownload: true, reason: 'missing date info' };
    }

    const apiDate = new Date(apiContainer.lastModifiedDate);
    const localDate = new Date(localInfo.lastModifiedDate);

    if (apiDate > localDate) {
      return { shouldDownload: true, reason: 'content changed' };
    }

    return { shouldDownload: false, reason: 'unchanged' };
  }
  
  try {
    // Phase 1: Collect all container metadata
    let containers = await apiClient.containerMethods.getContainerList(guid);

    totalContainers = containers.length;
    
    if (totalContainers === 0) {
      console.log("No containers found to download.");
      return;
    }


    // Phase 2: Analyze which containers need downloading
    // console.log(`\n📥 Processing ${totalContainers} containers with smart change detection...`);

    const downloadableContainers = [];
    const skippableContainers = [];

    for (const containerRef of containers) {
      const containerID = containerRef.contentViewID.toString();
      const containerName = containerRef.referenceName;
      const containerFilePath = path.join(containersFolderPath, `${containerID}.json`);
      
      // Get local container info for comparison
      const localInfo = getLocalContainerInfo(containerFilePath);
      const downloadDecision = shouldDownloadContainer(containerRef, localInfo);
      
      if (downloadDecision.shouldDownload) {
        downloadableContainers.push({ 
          containerRef, 
          containerID, 
          containerName, 
          reason: downloadDecision.reason 
        });
      } else {
        skippableContainers.push({ 
          containerRef, 
          containerID, 
          containerName, 
          reason: downloadDecision.reason 
        });
        
        // Record unchanged container in sync delta
        if (syncDeltaTracker) {
          syncDeltaTracker.recordChange({
            guid,
            id: containerRef.contentViewID,
            type: 'container',
            action: 'unchanged',
            name: containerRef.referenceName,
            referenceName: containerRef.referenceName,
          });
        }
      }
    }

    console.log(`\nContainer Change Detection Results: ${ansiColors.green(downloadableContainers.length.toString())} to download, ${ansiColors.gray(skippableContainers.length.toString())} unchanged`);

    // Phase 3: Download only the containers that need updating
    if (downloadableContainers.length === 0) {
      // console.log("✅ All containers are up to date!");
      return;
    }

    // Execute container downloads concurrently in batches
    const CONCURRENT_BATCH_SIZE = 20; // Download max 20 containers at once
    const batches = [];
    
    for (let i = 0; i < downloadableContainers.length; i += CONCURRENT_BATCH_SIZE) {
      batches.push(downloadableContainers.slice(i, i + CONCURRENT_BATCH_SIZE));
    }

    let processedCount = 0;
    let downloadedCount = 0;
    let skippedCount = skippableContainers.length;

    // Process each batch concurrently
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      // Create download promises for this batch
      const downloadPromises = batch.map(async (item) => {
        const { containerRef, containerID, containerName, reason } = item;
        try {
          // Fetch full container details
          const container = await apiClient.containerMethods.getContainerByID(containerID, guid);

                     // Export container JSON
           fileOps.exportFiles(`containers`, containerID.toString(), container);
          console.log(`✓ Downloaded container ${ansiColors.cyan(container.referenceName)} ID: ${container.contentViewID} ${ansiColors.gray(`(${reason})`)}`);
          
          // Record successful download in sync delta
          if (syncDeltaTracker) {
            syncDeltaTracker.recordChange({
              guid,
              id: container.contentViewID,
              type: 'container',
              action: reason === 'new file' ? 'created' : 'updated',
              name: container.referenceName,
              referenceName: container.referenceName,
            });
          }
          
          return { success: true, container };
        } catch (error: any) {
          console.error(`✗ Failed to download container ${ansiColors.red(containerName)} ID: ${containerID}`, ansiColors.gray(error.message ? `- ${error.message}` : ''));
          
          // Record error in sync delta
          if (syncDeltaTracker) {
            syncDeltaTracker.recordChange({
              guid,
              id: containerRef.contentViewID,
              type: 'container',
              action: 'error',
              name: containerRef.referenceName,
              referenceName: containerRef.referenceName,
            });
          }
          
          return { success: false, containerRef, error };
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
        
        // Update progress (include skipped containers in total processed)
        const totalProcessed = processedCount + skippedCount;
      }
    }

    // Performance and summary reporting
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    const errorCount = downloadableContainers.length - downloadedCount;

    console.log(`\n📊 Container Download Summary:`);
    console.log(`   ${ansiColors.green('✓')} Downloaded: ${downloadedCount}`);
    console.log(`   ${ansiColors.gray('⚬')} Unchanged: ${skippedCount}`);
    if (errorCount > 0) {
      console.log(`   ${ansiColors.red('✗')} Failed: ${errorCount}`);
    }
    console.log(`   ⏱️  Duration: ${duration}s`);

  } catch (error: any) {
    console.error('Error in downloadAllContainers:', error);
    throw error;
  }
}