import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState } from "../../core/state";
import * as path from "path";
import ansiColors from "ansi-colors";
import { ContentHashComparer } from "../shared/content-hash-comparer";

export async function downloadAllTemplates(
  fileOps: fileOperations,
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  // Get values from fileOps which is already configured for this specific GUID/locale
  const guid = fileOps.guid;
  const locale = fileOps.locale; // Templates need locale for API call
  const update = getState().update; // Use state.update instead of parameter
  const apiClient = getApiClient();

  if (!guid) {
    throw new Error('Source GUID not available in state');
  }

  const templatesFolderPath = fileOps.getDataFolderPath('templates');
  console.log('\n')
  // Individual template file existence checking is now handled below

  // Use fileOperations to create templates folder
  fileOps.createFolder('templates');

  let totalTemplates = 0; // Define totalTemplates in a broader scope for the catch block
  const startTime = Date.now(); // Track start time for performance measurement
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
      
      // Intelligent content comparison - check if content has actually changed
      // update=false (default): Use hash comparison for smart skipping
      // update=true: Force download/overwrite regardless of content
      if (!update) {
        const hashComparison = ContentHashComparer.getHashComparison(template, templateFilePath);
        
        if (hashComparison.status === 'unchanged') {
          const hashDisplay = hashComparison.shortHashes 
            ? `${ansiColors.green(`[${hashComparison.shortHashes.api}]`)}`
            : '';
          console.log(ansiColors.grey.italic('Found'), ansiColors.gray(`${template.pageTemplateName}`),ansiColors.grey.italic('content unchanged, skipping'), hashDisplay);
          skippedCount++;
        } else {
          // Any case that results in downloading (modified, not-exists, error)
          fileOps.exportFiles(`templates`, template.pageTemplateID, template);
          
          if (hashComparison.status === 'modified') {
            const hashDisplay = hashComparison.shortHashes 
              ? `${ansiColors.red(`[${hashComparison.shortHashes.local}`)} → ${ansiColors.green(`${hashComparison.shortHashes.api}]`)}`
              : '';
            console.log(`✓ Updated template ${ansiColors.cyan(template.pageTemplateName)} ID: ${template.pageTemplateID} ${ansiColors.gray('(content changed)')} ${hashDisplay}`);
          } else if (hashComparison.status === 'not-exists') {
            const hashDisplay = hashComparison.apiHash 
              ? `${ansiColors.green(`[${hashComparison.apiHash.substring(0, 6)}]`)}`
              : '';
            console.log(`✓ Downloaded template ${ansiColors.cyan(template.pageTemplateName)} ID: ${template.pageTemplateID} ${ansiColors.gray('(new file)')} ${hashDisplay}`);
          } else {
            console.log(`✓ Downloaded template ${ansiColors.cyan(template.pageTemplateName)} ID: ${template.pageTemplateID} ${ansiColors.gray('(error reading local file)')}`);
          }
        }
      } else {
        // Force update mode - always download
        fileOps.exportFiles(`templates`, template.pageTemplateID, template);
        console.log(`✓ Downloaded template ${ansiColors.cyan(template.pageTemplateName)} ID: ${template.pageTemplateID} ${ansiColors.gray('(forced update)')}`);
      }
      
      processedCount++;
      if (progressCallback) progressCallback(processedCount, totalTemplates, 'progress');
    }
    
    // Summary of downloaded templates
    const downloadedCount = processedCount - skippedCount;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\nDownloaded ${downloadedCount} templates (${downloadedCount}/${totalTemplates} templates, ${skippedCount} skipped, 0 errors) in ${elapsedSeconds}s\n`));
    // console.log("All page templates downloaded successfully.");
    if (progressCallback) progressCallback(totalTemplates, totalTemplates, 'success');
  } catch (error) {
    console.error("\nError downloading page templates:", error);
    // Use the totalTemplates variable from the outer scope
    if (progressCallback) progressCallback(0, totalTemplates, 'error'); 
    throw error; 
  }
} 