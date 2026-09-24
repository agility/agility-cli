import { fileOperations } from "core/fileOperations";
import { getApiClient, getLoggerForGuid, state } from "core/state";
import { removeLocalJsonNotIn } from "./reconcile-local-files";

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
      // Deliberately no reconciliation here: an empty list is far more likely a bad response than an
      // instance with zero templates, and deleting every local template on it would be worse.
      logger.template.skipped(null, "No page templates found to download");
      return;
    }

    // PROD-2614: getPageTemplates returns the complete list, so any local template file whose ID is
    // not in it belongs to a template deleted upstream. Left in place it is pushed as if it still
    // existed and can trip the same-name guardrail against a template that no longer exists.
    removeLocalJsonNotIn(
      templatesFolderPath,
      pageTemplates.map((t) => t.pageTemplateID),
      "template",
      (m) => logger.info(m)
    );

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
