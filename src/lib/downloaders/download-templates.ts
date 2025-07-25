import { fileOperations } from "core/fileOperations";
import { getApiClient, getLoggerForGuid, state } from "core/state";

export async function downloadAllTemplates(guid: string): Promise<void> {
  const fileOps = new fileOperations(guid);
  const locales = state.guidLocaleMap.get(guid); // Templates need locale for API call
  const apiClient = getApiClient();
  const logger = getLoggerForGuid(guid); // Use GUID-specific logger

  logger.startTimer();

  const templatesFolderPath = fileOps.getDataFolderPath("templates");
  fileOps.createFolder("templates");

  let totalTemplates = 0;
  try {
    let pageTemplates = await apiClient.pageMethods.getPageTemplates(guid, locales[0], true);
    totalTemplates = pageTemplates.length; // Assign here

    if (totalTemplates === 0) {
      logger.template.skipped(null, "No page templates found to download");
      return;
    }

    let processedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < totalTemplates; i++) {
      let template = pageTemplates[i];
      fileOps.exportFiles(`templates`, template.pageTemplateID, template);
      processedCount++;
      logger.template.downloaded(template);
    }

    logger.endTimer();
    const downloadedCount = processedCount - skippedCount;
    logger.summary("pull", downloadedCount, skippedCount, 0);
  } catch (error) {
    logger.error(`Error downloading page templates: ${error}`);
    throw error;
  }
}
