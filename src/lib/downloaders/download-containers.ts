import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { fileOperations } from "../services/fileOperations"; // Assuming fileOperations is in services
import * as fs from "fs"; // For checking if folder is empty
import * as path from "path"; // For path operations
import ansiColors from "ansi-colors";

export async function downloadAllContainers(
  guid: string,
  locale: string,
  isPreview: boolean,
  options: mgmtApi.Options,
  multibar: cliProgress.MultiBar,
  // basePath will be agility-files/{guid}/{locale}/{isPreview ? "preview" : "live"}
  // This is constructed by the caller (Pull service)
  basePath: string,
  forceOverwrite: boolean, // New parameter
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {

  // let basePath = path.join(rootPath, guid, locale, isPreview ? "preview" : "live");

  const containersFolderPath = path.join(basePath, 'containers');
  const fileOps = new fileOperations(basePath, guid, locale, isPreview);
  // let progressBar: cliProgress.SingleBar; // Old cli-progress bar, remove

  if (forceOverwrite) {
    // REMOVE: fs.rmSync for deleting the folder
    // if (fs.existsSync(containersFolderPath)) {
    //   console.log(ansiColors.yellow(`Overwrite selected: Deleting existing containers folder at ${containersFolderPath}`));
    //   fs.rmSync(containersFolderPath, { recursive: true, force: true });
    // }
    // ADD: Log message for overwriting
    // console.log(ansiColors.yellow(`Overwrite selected: Existing containers will be refreshed.`));
  } else {
    if (fs.existsSync(containersFolderPath)) {
      const files = fs.readdirSync(containersFolderPath);
      if (files.length > 0) {
        const pathParts = containersFolderPath.split('/');
        const displayPath = pathParts.slice(1).join('/'); // Changed from slice(0) to slice(1) to remove first part
        console.log(ansiColors.yellow(`Skipping Containers download as ${displayPath} exists, and overwrite not selected.`));
        // To correctly update progress, we should ideally know total containers even when skipping.
        // However, fetching total containers just to skip might be inefficient.
        // For now, assume success for the step if skipped.
        if (progressCallback) progressCallback(1, 1, 'success'); // Simplified success for skipped step
        return;
      }
    }
  }

  // Ensure base directory exists before trying to write containers
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
  }
  // Ensure containers directory exists
  if (!fs.existsSync(containersFolderPath)) {
    fs.mkdirSync(containersFolderPath, { recursive: true });
  }

  let apiClient = new mgmtApi.ApiClient(options);
  let totalContainers = 0; // Define totalContainers in a broader scope for the catch block
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
    if (progressCallback) progressCallback(0, totalContainers, 'progress');
    // console.log("Starting download of containers...");

    for (let i = 0; i < totalContainers; i++) {

      let container = await apiClient.containerMethods.getContainerByID(containers[i].contentViewID, guid);

      fileOps.exportFiles(`containers`, container.contentViewID, container, basePath);
      processedCount++;
      if (progressCallback) progressCallback(processedCount, totalContainers, 'progress');
      console.log(`✓ Downloaded container ${ansiColors.cyan(container.referenceName)} ID: ${container.contentViewID}`);
    }

    // Summary of downloaded containers
    console.log(ansiColors.yellow(`\nDownloaded ${totalContainers} containers (${processedCount}/${totalContainers} containers, 0 errors)\n`));
    // console.log("All page templates downloaded successfully.");
    if (progressCallback) progressCallback(totalContainers, totalContainers, 'success');
  } catch (error) {
    console.error("\nError downloading containers:", error);
    // Use the totalContainers variable from the outer scope
    if (progressCallback) progressCallback(0, totalContainers, 'error');
    throw error;
  }
}