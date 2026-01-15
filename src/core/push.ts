import * as path from "path";
import * as fs from "fs";
import { getState, initializeLogger, finalizeLogger, getLogger, state, setState } from "./state";
import ansiColors from "ansi-colors";
import { markPushStart, clearTimestamps } from "../lib/incremental";

import { Pushers, PushResults } from "../lib/pushers/orchestrate-pushers";
import { Pull } from "./pull";

export class Push {
  private pushers: Pushers;

  constructor() {
    // Initialize pusher orchestrator (pure business logic)
    this.pushers = new Pushers();
  }

  async pushInstances(fromSync: boolean = false): Promise<{ success: boolean; results: any[]; elapsedTime: number }> {
    const { isSync, sourceGuid, targetGuid, models, modelsWithDeps, autoPublish } = state;
    
    // Initialize logger for push operation
    // Determine if this is a sync operation by checking if both source and target GUIDs exist
    initializeLogger(isSync ? "sync" : "push");
    const logger = getLogger();

    // TODO: Add support for multiple GUIDs, multiple locales, multiple chanels
    // Currently only supports one GUID, one locale, one channel
    // Get all GUIDs to process (both source and target)
    const allGuids = [...sourceGuid, ...targetGuid];

    if (allGuids.length === 0) {
      throw new Error("No GUIDs specified for push operation");
    }

    // IMPORTANT: For sync operations, we need ALL elements downloaded to enable proper change detection
    // Model filtering happens at the processing level, not the download level
    const {  } = state;
    if (models && models.trim().length > 0 && (!modelsWithDeps || modelsWithDeps.trim().length === 0)) {
      // For simple --models flag (not --models-with-deps), we can restrict downloads to save time
      // But for sync operations, we still need all elements for change detection
      if (!isSync) {
        const { setState } = await import("./state");
        setState({ elements: 'Models' });
      }
      // For sync operations, leave elements as default to download everything
    }


    // pull the instance data
    const pull = new Pull();
    await pull.pullInstances(true);
    
    // Re-initialize logger after pull operation (pull finalizes its logger)
    initializeLogger(isSync ? "sync" : "push");
    
    // CONSOLE.LOG - Calculate total operations using per-GUID locale mapping
    let totalOperations = 0;
    const operationDetails: string[] = [];
    for (const guid of allGuids) {
      const guidLocales = state.guidLocaleMap.get(guid) || ["en-us"];
      totalOperations += guidLocales.length;
      operationDetails.push(`${guid}: ${guidLocales.join(", ")}`);
    }
    // operationDetails.forEach(detail => console.log(`${detail}`));

    // Handle --reset flag: completely delete GUID folders and start fresh
    if (state.reset) {
      for (const guid of allGuids) {
        await this.handleResetFlag(guid);
      }
    }

    // Mark the start of this pull operation for incremental tracking
    markPushStart();
    const totalStartTime = Date.now();

    try {
      // Execute sequential pushes for all GUIDs, locales and channels (sitemaps)
      const results = await this.pushers.instanceOrchestrator();

      const totalElapsedTime = Date.now() - totalStartTime;

      // Calculate success/failure counts
      let totalSuccessful = 0;
      let totalFailed = 0;

      results.forEach((result: PushResults) => {
        if (result.failed?.length > 0) {
          totalFailed++;
        } else {
          totalSuccessful++;
        }
      });

      const success = totalFailed === 0;

      // Use the orchestrator summary function to handle all completion logic
      const logger = getLogger();
        
      if (logger) {
        
        const logFilePaths = results
        .map(res => res.logFilePath)
        .filter(path => path);
      
        logger.orchestratorSummary(results, totalElapsedTime, success, logFilePaths);
      }

      finalizeLogger(); // Finalize global logger if it exists

      // Auto-publish if enabled and sync was successful
      if (isSync && autoPublish && success) {
        await this.executeAutoPublish(results, autoPublish);
      }
      
      // Only exit if not called from another operation
    
      return {
        success,
        results,
        elapsedTime: totalElapsedTime,
      };

    } catch (error: any) {
      console.error(ansiColors.red("\n❌ An error occurred during the push command:"), error);
      finalizeLogger(); // Finalize logger even on error
      
      // Only exit if not called from another operation
      // process.exit(1);
      
      throw error; // Let calling code handle error response
    }
  }

  /**
   * Execute auto-publish after sync completes
   */
  private async executeAutoPublish(results: PushResults[], autoPublishMode: string): Promise<void> {
    // Collect all publishable IDs from sync results
    const allContentIds: number[] = [];
    const allPageIds: number[] = [];

    for (const result of results) {
      if (result.publishableContentIds && result.publishableContentIds.length > 0) {
        allContentIds.push(...result.publishableContentIds);
      }
      if (result.publishablePageIds && result.publishablePageIds.length > 0) {
        allPageIds.push(...result.publishablePageIds);
      }
    }

    // Determine what to publish based on mode
    const publishContent = autoPublishMode === 'content' || autoPublishMode === 'both';
    const publishPages = autoPublishMode === 'pages' || autoPublishMode === 'both';

    const contentIdsToPublish = publishContent ? allContentIds : [];
    const pageIdsToPublish = publishPages ? allPageIds : [];

    // Check if there's anything to publish
    if (contentIdsToPublish.length === 0 && pageIdsToPublish.length === 0) {
      console.log(ansiColors.yellow('\n⚠️ Auto-publish: No items to publish from sync operation'));
      return;
    }

    console.log(ansiColors.cyan('\n' + '═'.repeat(50)));
    console.log(ansiColors.cyan('🚀 AUTO-PUBLISH'));
    console.log(ansiColors.cyan('═'.repeat(50)));
    console.log(ansiColors.gray(`Mode: ${autoPublishMode}`));
    console.log(ansiColors.gray(`Content items to publish: ${contentIdsToPublish.length}`));
    console.log(ansiColors.gray(`Pages to publish: ${pageIdsToPublish.length}`));

    try {
      // Set explicit IDs in state for the workflow operation
      setState({
        explicitContentIDs: contentIdsToPublish,
        explicitPageIDs: pageIdsToPublish,
        operationType: 'publish'
      });

      // Import and execute workflow operation
      const { WorkflowOperation } = await import('../lib/workflows');
      const workflowOp = new WorkflowOperation();
      await workflowOp.executeFromMappings();

    } catch (error: any) {
      console.error(ansiColors.red(`\n❌ Auto-publish failed: ${error.message}`));
    }
  }

  private async handleResetFlag(guid: string): Promise<void> {
    const state = getState();
    const guidFolderPath = path.join(process.cwd(), state.rootPath, guid);

    if (fs.existsSync(guidFolderPath)) {
      console.log(ansiColors.red(`🔄 --reset flag detected: Deleting entire instance folder ${guidFolderPath}`));

      try {
        fs.rmSync(guidFolderPath, { recursive: true, force: true });
        console.log(ansiColors.green(`✓ Successfully deleted instance folder: ${guidFolderPath}`));
      } catch (resetError: any) {
        console.error(ansiColors.red(`✗ Error deleting instance folder: ${resetError.message}`));
        throw resetError;
      }
    } else {
      console.log(ansiColors.yellow(`⚠️ Instance folder ${guidFolderPath} does not exist (already clean)`));
    }

    // Clear timestamp tracking for this instance
    clearTimestamps(guid, state.rootPath);
  }
}
