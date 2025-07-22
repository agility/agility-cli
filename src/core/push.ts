import * as path from "path";
import * as fs from "fs";
import { getState } from "./state";
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

  async pushInstances(): Promise<{ success: boolean; results: any[]; elapsedTime: number }> {
    const state = getState();

    // TODO: Add support for multiple GUIDs, multiple locales, multiple chanels
    // Currently only supports one GUID, one locale, one channel
    // Get all GUIDs to process (both source and target)
    const allGuids = [...state.sourceGuid, ...state.targetGuid];

    if (allGuids.length === 0) {
      throw new Error("No GUIDs specified for push operation");
    }

    console.log(ansiColors.bgCyan(`state.update: ${state.update}`));
    // pull the instance data
    if (state.update !== false) {
      const pull = new Pull();
      await pull.pullInstances();
    }

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
      // Execute concurrent pushes for all GUIDs, locales and channels (sitemaps)
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

      return {
        success,
        results,
        elapsedTime: totalElapsedTime,
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
