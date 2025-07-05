import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { fileOperations } from "../services/fileOperations"; // Assuming fileOperations is in services
import { state, getApiClient } from "../services/state";
import * as fs from "fs"; // For checking if folder is empty
import * as path from "path"; // For path operations
import ansiColors from "ansi-colors";

export async function downloadAllTemplates(
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

  const templatesFolderPath = fileOps.getDataFolderPath('templates');

  // Individual template file existence checking is now handled below

  // Use fileOperations to create templates folder
  fileOps.createFolder('templates');

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
    let skippedCount = 0;
    if (progressCallback) progressCallback(0, totalTemplates, 'progress');
    // console.log("Starting download of page templates...");

    for (let i = 0; i < totalTemplates; i++) {
      let template = pageTemplates[i];
      const templateFilePath = path.join(templatesFolderPath, `${template.pageTemplateID}.json`);
      
      // Check if we should skip file existence check based on update flag
      // update=false (default): Skip existing files, update=true: Force download/overwrite
      if (!update && fs.existsSync(templateFilePath)) {
        console.log(ansiColors.grey.italic('Found'), ansiColors.gray(`${template.pageTemplateName}`),ansiColors.grey.italic('skipping download'));
        skippedCount++;
      } else {
        fileOps.exportFiles(`templates`, template.pageTemplateID, template);
        console.log(`✓ Downloaded template ${ansiColors.cyan(template.pageTemplateName)} ID: ${template.pageTemplateID}`);
      }
      
      processedCount++;
      if (progressCallback) progressCallback(processedCount, totalTemplates, 'progress');
    }
    
    // Summary of downloaded templates
    const downloadedCount = processedCount - skippedCount;
    console.log(ansiColors.yellow(`\nDownloaded ${downloadedCount} templates (${downloadedCount}/${totalTemplates} templates, ${skippedCount} skipped, 0 errors)\n`));
    // console.log("All page templates downloaded successfully.");
    if (progressCallback) progressCallback(totalTemplates, totalTemplates, 'success');
  } catch (error) {
    console.error("\nError downloading page templates:", error);
    // Use the totalTemplates variable from the outer scope
    if (progressCallback) progressCallback(0, totalTemplates, 'error'); 
    throw error; 
  }
} 