import * as path from "path";
import * as fs from "fs";
import { getState } from "./state";
import ansiColors from "ansi-colors";
import {
  markPullStart,
  clearTimestamps,
} from "../lib/incremental";

import { DownloadOrchestrator } from "../lib/downloaders/orchestrate-downloaders";

export class Pull {
  private downloadOrchestrator: DownloadOrchestrator;

  constructor() {
    // Initialize download orchestrator (pure business logic)
    this.downloadOrchestrator = new DownloadOrchestrator({
      operationName: 'Pull',
      onStepStart: (stepName, guid) => console.log(`Starting ${stepName} for ${guid}...`),
      onStepComplete: (stepName, guid, success) => {
        if (success) {
          console.log(`✓ ${stepName} completed successfully`);
        } else {
          console.log(`✗ ${stepName} failed`);
        }
      }
    });
  }

  async pullInstances(): Promise<{ success: boolean; results: any[]; elapsedTime: number }> {
    const state = getState();
    
    // Get all GUIDs to process (both source and target)
    const allGuids = [...state.sourceGuid, ...state.targetGuid];
    
    if (allGuids.length === 0) {
      throw new Error('No GUIDs specified for pull operation');
    }

    // Calculate total operations using per-GUID locale mapping
    let totalOperations = 0;
    const operationDetails: string[] = [];
    
    for (const guid of allGuids) {
      const guidLocales = state.guidLocaleMap.get(guid) || ['en-us'];
      totalOperations += guidLocales.length;
      operationDetails.push(`${guid}: ${guidLocales.join(', ')}`);
    }

 
    operationDetails.forEach(detail => console.log(`${detail}`));
    
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
      // Execute concurrent downloads for all GUIDs and locales
      const results = await this.downloadOrchestrator.executeAllDownloadsConcurrently();
      
      const totalElapsedTime = Date.now() - totalStartTime;

      // Calculate success/failure counts
      let totalSuccessful = 0;
      let totalFailed = 0;
      
      results.forEach(result => {
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
