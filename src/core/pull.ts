import * as mgmtApi from "@agility/management-sdk";
import * as path from "path";
import * as fs from "fs";
import { overwritePrompt } from "../lib/ui/prompts";
import { getState } from "./state";
import { fileOperations } from "./fileOperations";
import { generateLogHeader } from "../lib/shared";
import ansiColors from "ansi-colors";
import {
  markPullStart,
  clearTimestamps,
} from "../lib/incremental";

// Import the extracted services
import { BlessedUIManager } from "../lib/ui/blessed/blessed-ui-manager";
import { ConsoleManager } from "../lib/ui/console/console-manager";
import { ProgressTracker } from "../lib/ui/progress/progress-tracker";
import { DownloadOrchestrator } from "../lib/downloaders/orchestrate-downloaders";

export class Pull {
  // Services
  private blessedUI?: BlessedUIManager;
  private consoleManager?: ConsoleManager;
  private progressTracker?: ProgressTracker;
  private downloadOrchestrator: DownloadOrchestrator;

  constructor() {
    // Initialize services based on UI mode
    this.initializeServices();
  }

  private initializeServices(): void {
    const state = getState();
    
    // Auto-disable blessed UI for concurrent operations (multiple GUID×locale combinations)
    const allGuids = [...state.sourceGuid, ...state.targetGuid];
    let totalOperations = 0;
    
    // Calculate total operations using per-GUID locale mapping
    for (const guid of allGuids) {
      const guidLocales = state.guidLocaleMap.get(guid) || ['en-us'];
      totalOperations += guidLocales.length;
    }
    
    if (totalOperations > 1 && state.useBlessed) {
      console.log(ansiColors.yellow(`Auto-disabling Blessed UI: ${totalOperations} concurrent operations detected`));
      state.useBlessed = false;
      // Default to headless mode for concurrent operations
      if (!state.useVerbose && !state.useHeadless) {
        state.useHeadless = true;
      }
    }
    
    // Initialize download orchestrator (always needed)
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
    
    // Initialize UI services based on mode
    if (state.useBlessed) {
      this.blessedUI = new BlessedUIManager({
        title: 'Agility CLI - Pull Progress',
        steps: state.elements.split(','),
        enableAutoExit: true,
        autoExitDelay: 5
      });
      this.progressTracker = new ProgressTracker('Pull');
    } else if (state.useHeadless) {
      this.consoleManager = new ConsoleManager();
      this.progressTracker = new ProgressTracker('Pull');
    } else if (state.useVerbose) {
      this.consoleManager = new ConsoleManager();
      this.progressTracker = new ProgressTracker('Pull');
    } else {
      this.consoleManager = new ConsoleManager();
      this.progressTracker = new ProgressTracker('Pull');
    }
  }

  /**
   * Log pull operation header with version info
   */
  private logPullHeader(guid: string, locale: string): void {
    const state = getState();
    const headerInfo = generateLogHeader("Pull", {
      "Source GUID": guid,
      Elements: state.elements,
      Locale: locale,
      Channel: state.channel,
      "Preview Mode": state.preview,
      Update: state.update,
      "Reset Mode": state.reset,
      Mode: state.useHeadless ? "Headless" : state.useVerbose ? "Verbose" : state.useBlessed ? "Blessed UI" : "Standard",
    });

    // Create fileOps for this specific GUID and locale
    const fileOps = new fileOperations(state.rootPath, guid, locale, state.preview);
    fileOps.appendLogFile(`${headerInfo}\n`);
  }

  async pullInstance(): Promise<void> {
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

    console.log(ansiColors.cyan('\n🚀 Pull Operation using GUID×Locale Matrix:'));
    console.log(`Total operations: ${totalOperations} (${allGuids.length} instances × variable locales)`);
    operationDetails.forEach(detail => console.log(`   📋 ${detail}`));
    console.log(`Channel: ${state.channel} | ${state.preview ? "Preview" : "Live"} | Elements: ${state.elements}`);
    console.log(`Output: ./agility-files/`);

    // Handle --reset flag: completely delete GUID folders and start fresh
    if (state.reset) {
      for (const guid of allGuids) {
        await this.handleResetFlag(guid);
      }
    }

    // Mark the start of this pull operation for incremental tracking
    const pullStartTime = markPullStart();
    const totalStartTime = Date.now();

    try {
      // Initialize UI services
      await this.initializeUI();

      // Execute concurrent downloads for all GUIDs and locales
      const results = await this.downloadOrchestrator.executeAllDownloadsConcurrently();

      // Show completion summary
      await this.showCompletionSummary(results, totalStartTime);

    } catch (error: any) {
      console.error(ansiColors.red("\n❌ An error occurred during the pull command:"), error);
      await this.cleanup();
      process.exit(1);
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

  private async initializeUI(): Promise<void> {
    const state = getState();
    
    if (state.useBlessed && this.blessedUI) {
      this.blessedUI.setup();
    }
    
    if (this.consoleManager) {
      // Create a temporary fileOps for console manager setup
      // In multi-GUID mode, we'll use individual fileOps per operation
      const tempFileOps = new fileOperations(
        state.rootPath, 
        state.sourceGuid[0] || 'temp', 
        state.locale[0] || 'en-us', 
        state.preview
      );
      
      this.consoleManager.setupMode(
        state.useHeadless ? 'headless' : 
        state.useVerbose ? 'verbose' : 
        state.useBlessed ? 'blessed' : 'plain',
        tempFileOps,
        this.blessedUI ? {
          onLog: (message) => this.blessedUI?.log(message),
          onError: (message) => this.blessedUI?.log(message)
        } : undefined
      );
    }
    
    if (this.progressTracker) {
      this.progressTracker.initializeSteps(getState().elements.split(','));
    }
  }



  private getUIMode(): 'blessed' | 'headless' | 'verbose' | 'plain' {
    const state = getState();
    
    if (state.useBlessed) return 'blessed';
    if (state.useHeadless) return 'headless';
    if (state.useVerbose) return 'verbose';
    return 'plain';
  }

  private async showCompletionSummary(allResults: any[], startTime: number): Promise<void> {
    const state = getState();
    const totalElapsedTime = Date.now() - startTime;
    const totalElapsedSeconds = Math.floor(totalElapsedTime / 1000);
    const minutes = Math.floor(totalElapsedSeconds / 60);
    const seconds = totalElapsedSeconds % 60;
    const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    // Collect log file paths
    const logFilePaths: string[] = [];
    let totalSuccessful = 0;
    let totalFailed = 0;
    
    allResults.forEach(result => {
      // Count success/failure at GUID+locale level
      if (result.failed?.length > 0) {
        totalFailed++;
      } else {
        totalSuccessful++;
      }
      
      // Collect log file paths
      if (result.logFilePath) {
        logFilePaths.push(result.logFilePath);
      }
    });
    
    const summaryMessage = `Pull completed: ${totalSuccessful}/${allResults.length} successful, ${totalFailed} errors, ${timeDisplay}`;
    
    console.log(ansiColors.cyan('\nSummary:'));
    console.log(`Processed ${allResults.length} GUID/locale combinations`);
    console.log(`${totalSuccessful} successful, ${totalFailed} failed`);
    console.log(`Total time: ${timeDisplay}`);
    
    // Display log file paths
    if (logFilePaths.length > 0) {
      console.log(ansiColors.cyan('\nLog Files:'));
      logFilePaths.forEach(logPath => {
        console.log(logPath);
      });
    }
    
    if (state.useBlessed && this.blessedUI) {
      // Show completion in Blessed UI with auto-exit
      this.blessedUI.log("----------------------------------------------------------------------");
      this.blessedUI.log(summaryMessage);
      if (logFilePaths.length > 0) {
        this.blessedUI.log(`Log files: ${logFilePaths.join(', ')}`);
      }
      this.blessedUI.log("Press Ctrl+C to exit.");
      this.blessedUI.startAutoExit();
    } else {
      // Show completion in console
      console.log(ansiColors.green(summaryMessage));
      this.finalizeAndExit();
    }
  }

  private finalizeAndExit(): void {
    // Clean up services
    this.cleanup();
    
    if (this.getUIMode() !== 'blessed') {
      process.exit(0);
    }
  }

  private async cleanup(): Promise<void> {
    if (this.blessedUI) {
      this.blessedUI.cleanup();
    }
    
    if (this.consoleManager) {
      this.consoleManager.restoreConsole();
    }
    
    if (this.progressTracker) {
      this.progressTracker.reset();
    }
  }
}
