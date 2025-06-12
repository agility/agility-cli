import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { fileOperations } from "../services/fileOperations"; // Assuming fileOperations is in services
import * as fs from "fs"; // For checking if folder is empty
import * as path from "path"; // For path operations
import ansiColors from "ansi-colors";

export async function downloadAllTemplates(
  guid: string,
  locale: string,
  isPreview: boolean,
  options: mgmtApi.Options,
  multibar: cliProgress.MultiBar,
  fileOps: fileOperations,
  forceOverwrite: boolean, // New parameter
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {

  const templatesFolderPath = fileOps.getDataFolderPath('templates');
  // let progressBar: cliProgress.SingleBar; // Old cli-progress bar, remove

  if (forceOverwrite) {
    // REMOVE: fs.rmSync for deleting the folder
    // if (fs.existsSync(templatesFolderPath)) {
    //   console.log(ansiColors.yellow(`Overwrite selected: Deleting existing templates folder at ${templatesFolderPath}`));
    //   fs.rmSync(templatesFolderPath, { recursive: true, force: true });
    // }
    // ADD: Log message for overwriting
    // console.log(ansiColors.yellow(`Overwrite selected: Existing templates will be refreshed.`));
  } else {
    if (fs.existsSync(templatesFolderPath)) {
      const files = fs.readdirSync(templatesFolderPath);
      if (files.length > 0) {
        const pathParts = templatesFolderPath.split('/');
        const displayPath = pathParts.slice(1).join('/'); // Changed from slice(0) to slice(1) to remove first part
        console.log(ansiColors.yellow(`Skipping Templates download as ${displayPath} exists, and overwrite not selected.`));
        // To correctly update progress, we should ideally know total templates even when skipping.
        // However, fetching total templates just to skip might be inefficient.
        // For now, assume success for the step if skipped.
        if (progressCallback) progressCallback(1, 1, 'success'); // Simplified success for skipped step
        return;
      }
    }
  }

  // Use fileOperations to create templates folder
  fileOps.createFolder('templates');

  let apiClient = new mgmtApi.ApiClient(options);
  let totalTemplates = 0; // Define totalTemplates in a broader scope for the catch block
  try {
    // console.log("Fetching list of page templates...");
    let pageTemplates = await apiClient.pageMethods.getPageTemplates(guid, locale, true); 
    totalTemplates = pageTemplates.length; // Assign here
    // console.log(`Found ${totalTemplates} page templates to download.`);

    if (totalTemplates === 0) {
        console.log("No page templates found to download.");
        if (progressCallback) progressCallback(0, 0, 'success'); 
        return;
    }

    let processedCount = 0;
    if (progressCallback) progressCallback(0, totalTemplates, 'progress');
    // console.log("Starting download of page templates...");

    for (let i = 0; i < totalTemplates; i++) {
      let template = pageTemplates[i];
      fileOps.exportFiles(`templates`, template.pageTemplateID, template);
      processedCount++;
      if (progressCallback) progressCallback(processedCount, totalTemplates, 'progress');
      console.log(`✓ Downloaded template ${ansiColors.cyan(template.pageTemplateName)} ID: ${template.pageTemplateID}`);
    }
    
    // Summary of downloaded templates
    console.log(ansiColors.yellow(`\nDownloaded ${totalTemplates} templates (${processedCount}/${totalTemplates} templates, 0 errors)\n`));
    // console.log("All page templates downloaded successfully.");
    if (progressCallback) progressCallback(totalTemplates, totalTemplates, 'success');
  } catch (error) {
    console.error("\nError downloading page templates:", error);
    // Use the totalTemplates variable from the outer scope
    if (progressCallback) progressCallback(0, totalTemplates, 'error'); 
    throw error; 
  }
} 