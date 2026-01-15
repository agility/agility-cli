import * as path from "path";
import * as fs from "fs";
import { getState, initializeLogger, finalizeLogger, getLogger } from "./state";
import ansiColors from "ansi-colors";
import { markPullStart, clearTimestamps } from "../lib/incremental";
import { waitForFetchApiSync } from "../lib/shared/get-fetch-api-status";

import { Downloader } from "../lib/downloaders/orchestrate-downloaders";

export class Pull {
  private downloader: Downloader;

  constructor() {
    // Initialize download orchestrator (pure business logic)
    this.downloader = new Downloader();
  }

  async pullInstances(fromPush: boolean = false): Promise<{ success: boolean; results: any[]; elapsedTime: number }> {
    const state = getState();
    
    // Initialize logger inside the method so it works correctly when called from push operations
    // But only if not called from push operation (to avoid conflicts with push logger)
    if (!fromPush) {
      initializeLogger("pull");
    }

    // TODO: Add support for multiple GUIDs, multiple locales, multiple chanels
    // Currently only supports one GUID, one locale, one channel
    // Get all GUIDs to process (both source and target)
    const { update } = state;

    let allGuids = [];
    if (update === false && fromPush === true) {
      allGuids = [...state.targetGuid];
    } else if (update === true && fromPush === true) {
      allGuids = [...state.sourceGuid, ...state.targetGuid];
    } else if (update === true && fromPush === false) {
      allGuids = [...state.sourceGuid];
    }

    if (allGuids.length === 0) {
      throw new Error("No GUIDs specified for pull operation");
    }

    // Calculate total operations using per-GUID locale mapping
    let totalOperations = 0;
    const operationDetails: string[] = [];

    for (const guid of allGuids) {
      const guidLocales = state.guidLocaleMap.get(guid) || ["en-us"];
      totalOperations += guidLocales.length;
      operationDetails.push(`${guid}: ${guidLocales.join(", ")}`);
    }

    // operationDetails.forEach((detail) => console.log(`${detail}`));

    // Handle --reset flag: completely delete GUID folders and start fresh
    if (state.reset) {
      for (const guid of allGuids) {
        await this.handleResetFlag(guid);
      }
    }

    // Mark the start of this pull operation for incremental tracking
    markPullStart();
    const totalStartTime = Date.now();

    try {
      // Wait for Fetch API sync to complete before pulling (only for standalone pull operations)
      // This ensures we're pulling the latest data from the CDN
      // Skip when called from push - the refresh-mappings workflow handles this separately
      if (!fromPush) {
        for (const guid of allGuids) {
          try {
            await waitForFetchApiSync(guid, 'fetch', false);
          } catch (error: any) {
            // Log warning but don't fail the pull - the API might not support this endpoint yet
            console.log(ansiColors.yellow(`⚠️ Could not check Fetch API status for ${guid}: ${error.message}`));
          }
        }
      }

      // Execute concurrent downloads for all GUIDs, locales and channels (sitemaps)
      const results = await this.downloader.instanceOrchestrator(fromPush);

      const totalElapsedTime = Date.now() - totalStartTime;

      // Calculate success/failure counts
      let totalSuccessful = 0;
      let totalFailed = 0;

      results.forEach((result) => {
        if (result.failed?.length > 0) {
          totalFailed++;
        } else {
          totalSuccessful++;
        }
      });

      const success = totalFailed === 0;

      // Only show completion summary and finalize logger for standalone pull operations
      // When called from push/sync, the parent operation handles its own summary
      if (!fromPush) {
        const logger = getLogger();
        if (logger) {
          // Collect log file paths
          const logFilePaths = results
            .map(res => res.logFilePath)
            .filter(path => path);
          
          logger.orchestratorSummary(results, totalElapsedTime, success, logFilePaths);
        }

        finalizeLogger(); // Finalize global logger if it exists
        process.exit(success ? 0 : 1);
      }

      // Return results for use by calling code (especially when fromPush = true)
      return {
        success,
        results,
        elapsedTime: totalElapsedTime
      };

    } catch (error: any) {
      console.error(ansiColors.red("\n❌ An error occurred during the pull command:"), error);
      throw error; // Let calling code handle error response
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
