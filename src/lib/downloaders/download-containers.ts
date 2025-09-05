import { fileOperations } from '../../core/fileOperations';
import { getApiClient, getLoggerForGuid, getState, state } from '../../core/state';
import * as path from 'path';
import ansiColors from 'ansi-colors';
// import { ChangeDelta } from "../shared/change-delta-tracker";
import * as fs from 'fs';
import { parse } from 'date-fns';

export async function downloadAllContainers(
  guid: string
  // changeDelta: ChangeDelta
): Promise<void> {
  const fileOps = new fileOperations(guid);
  const update = state.update; // Use state.update instead of parameter
  const apiClient = getApiClient();
  const logger = getLoggerForGuid(guid); // Use GUID-specific logger

  if (!logger) {
    console.warn(`⚠️  No logger found for GUID ${guid}, skipping container logging`);
    return;
  }

  logger.startTimer();

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
        exists: true,
      };
    } catch (error) {
      return { exists: false };
    }
  }

  // Helper function to check if container needs download based on lastModifiedDate
  function shouldDownloadContainer(
    apiContainer: any,
    localInfo: { lastModifiedDate?: string; exists: boolean }
  ): { shouldDownload: boolean; reason: string } {
    if (state.update === false) {
      return { shouldDownload: false, reason: '' };
    }

    if (!localInfo.exists) {
      return { shouldDownload: true, reason: 'new file' };
    }

    if (!localInfo.lastModifiedDate || !apiContainer.lastModifiedDate) {
      return { shouldDownload: true, reason: 'missing date info' };
    }
    //the date format is: 07/23/2025 08:22PM (MM/DD/YYYY hh:mma) so we need to convert it to a Date object
    // Note: This assumes the date is in the format MM/DD/YYYY hh:mma
    // If the date format is different, you may need to adjust the parsing logic accordingly
    const apiDateTime = parse(apiContainer.lastModifiedDate, 'MM/dd/yyyy hh:mma', new Date());
    const localeDateTime = parse(localInfo.lastModifiedDate, 'MM/dd/yyyy hh:mma', new Date());

    if (apiDateTime > localeDateTime && state.update === true) {
      return { shouldDownload: true, reason: 'content changed' };
    }

    return { shouldDownload: false, reason: 'unchanged' };
  }

  try {
    // Phase 1: Collect all container metadata
    let containers = await apiClient.containerMethods.getContainerList(guid);

    totalContainers = containers.length;

    if (totalContainers === 0) {
      logger.info('No containers found to download');
      return;
    }

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
          reason: downloadDecision.reason,
        });
      } else {
        skippableContainers.push({
          containerRef,
          containerID,
          containerName,
          reason: downloadDecision.reason,
        });
      }
    }

    if (skippableContainers.length > 0) {
      logger.changeDetectionSummary(
        'container',
        downloadableContainers.length,
        skippableContainers.length
      );
    }

    // Phase 3: Download only the containers that need updating
    if (downloadableContainers.length === 0) {
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
          logger.container.downloaded(container);

          return { success: true, container };
        } catch (error: any) {
          logger.container.error(null, `ID: ${containerID} - ${error.message || 'Unknown error'}`);
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
    logger.endTimer();
    const errorCount = downloadableContainers.length - downloadedCount;
    logger.summary('pull', downloadedCount, skippedCount, errorCount);
  } catch (error: any) {
    logger.error(`Error in downloadAllContainers: ${error.message || error}`);
    throw error;
  }
}
