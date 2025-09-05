import * as path from 'path';
import * as fs from 'fs';
import { getState, initializeLogger, finalizeLogger, getLogger, state } from './state';
import ansiColors from 'ansi-colors';
import { markPushStart, clearTimestamps } from '../lib/incremental';

import { Pushers, PushResults } from '../lib/pushers/orchestrate-pushers';
import { Pull } from './pull';

export class Push {
  private pushers: Pushers;

  constructor() {
    // Initialize pusher orchestrator (pure business logic)
    this.pushers = new Pushers();
  }

  async pushInstances(
    fromSync: boolean = false
  ): Promise<{ success: boolean; results: any[]; elapsedTime: number }> {
    const { isSync, sourceGuid, targetGuid, models, modelsWithDeps } = state;

    // Initialize logger for push operation
    // Determine if this is a sync operation by checking if both source and target GUIDs exist
    initializeLogger(isSync ? 'sync' : 'push');
    const logger = getLogger();

    // TODO: Add support for multiple GUIDs, multiple locales, multiple chanels
    // Currently only supports one GUID, one locale, one channel
    // Get all GUIDs to process (both source and target)
    const allGuids = [...sourceGuid, ...targetGuid];

    if (allGuids.length === 0) {
      throw new Error('No GUIDs specified for push operation');
    }

    // IMPORTANT: Apply model filtering before downloads to prevent unwanted elements
    const {} = state;
    if (
      models &&
      models.trim().length > 0 &&
      (!modelsWithDeps || modelsWithDeps.trim().length === 0)
    ) {
      // Override state.elements to prevent dependency forcing from downloading unwanted elements
      const { setState } = await import('./state');
      setState({ elements: 'Models' });
    }

    // pull the instance data
    const pull = new Pull();
    await pull.pullInstances(true);

    // Re-initialize logger after pull operation (pull finalizes its logger)
    initializeLogger(isSync ? 'sync' : 'push');

    // CONSOLE.LOG - Calculate total operations using per-GUID locale mapping
    let totalOperations = 0;
    const operationDetails: string[] = [];
    for (const guid of allGuids) {
      const guidLocales = state.guidLocaleMap.get(guid) || ['en-us'];
      totalOperations += guidLocales.length;
      operationDetails.push(`${guid}: ${guidLocales.join(', ')}`);
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
        const logFilePaths = results.map((res) => res.logFilePath).filter((path) => path);

        logger.orchestratorSummary(results, totalElapsedTime, success, logFilePaths);
      }

      finalizeLogger(); // Finalize global logger if it exists

      // Only exit if not called from another operation

      return {
        success,
        results,
        elapsedTime: totalElapsedTime,
      };
    } catch (error: any) {
      console.error(ansiColors.red('\n❌ An error occurred during the push command:'), error);
      finalizeLogger(); // Finalize logger even on error

      // Only exit if not called from another operation
      // process.exit(1);

      throw error; // Let calling code handle error response
    }
  }

  private async handleResetFlag(guid: string): Promise<void> {
    const state = getState();
    const guidFolderPath = path.join(process.cwd(), state.rootPath, guid);

    if (fs.existsSync(guidFolderPath)) {
      console.log(
        ansiColors.red(
          `🔄 --reset flag detected: Deleting entire instance folder ${guidFolderPath}`
        )
      );

      try {
        fs.rmSync(guidFolderPath, { recursive: true, force: true });
        console.log(ansiColors.green(`✓ Successfully deleted instance folder: ${guidFolderPath}`));
      } catch (resetError: any) {
        console.error(ansiColors.red(`✗ Error deleting instance folder: ${resetError.message}`));
        throw resetError;
      }
    } else {
      console.log(
        ansiColors.yellow(`⚠️ Instance folder ${guidFolderPath} does not exist (already clean)`)
      );
    }

    // Clear timestamp tracking for this instance
    clearTimestamps(guid, state.rootPath);
  }
}
