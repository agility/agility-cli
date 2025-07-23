import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState, state } from "../../core/state";
import * as path from "path";
import ansiColors from "ansi-colors";
import { getAllChannels } from "../shared/get-all-channels";

export async function downloadAllTemplates(
  guid: string
): Promise<void> {
  const fileOps = new fileOperations(guid);
  const locales = state.guidLocaleMap.get(guid); // Templates need locale for API call
  const update = state.update; // Use state.update instead of parameter
  const apiClient = getApiClient();
  
  const channels = await getAllChannels(guid, locales[0]);
  const templatesFolderPath = fileOps.getDataFolderPath('templates');
  // Individual template file existence checking is now handled below

  // Use fileOperations to create templates folder
  fileOps.createFolder('templates');

  let totalTemplates = 0; // Define totalTemplates in a broader scope for the catch block
  const startTime = Date.now(); // Track start time for performance measurement
  try {
    // console.log("Fetching list of page templates...");
    let pageTemplates = await apiClient.pageMethods.getPageTemplates(guid, locales[0], true); 
    totalTemplates = pageTemplates.length; // Assign here
    // console.log(`Found ${totalTemplates} page templates to download.`);

    if (totalTemplates === 0) {
        console.log("No page templates found to download.");
        return;
    }

    let processedCount = 0;
    let skippedCount = 0;
    // console.log("Starting download of page templates...");

    for (let i = 0; i < totalTemplates; i++) {
      let template = pageTemplates[i];
      const templateFilePath = path.join(templatesFolderPath, `${template.pageTemplateID}.json`);
      
      // Intelligent content comparison - check if content has actually changed
      // update=false (default): Use hash comparison for smart skipping
      // update=true: Force download/overwrite regardless of content

     
      
        // Force update mode - always download
        fileOps.exportFiles(`templates`, template.pageTemplateID, template);
        processedCount++;
        console.log(`✓ Downloaded template ${ansiColors.cyan(template.pageTemplateName)} ID: ${template.pageTemplateID} ${ansiColors.gray('(forced update)')}`);
      }
      
     
    
    
    // Summary of downloaded templates
    const downloadedCount = processedCount - skippedCount;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\nDownloaded ${downloadedCount} templates (${downloadedCount}/${totalTemplates} templates, ${skippedCount} skipped, 0 errors) in ${elapsedSeconds}s\n`));
    // console.log("All page templates downloaded successfully.");
  } catch (error) {
    console.error("\nError downloading page templates:", error);
    // Use the totalTemplates variable from the outer scope
    throw error; 
  }
} 
