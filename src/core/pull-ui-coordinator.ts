import ansiColors from "ansi-colors";
import { getState } from "./state";
import { Pull } from "./pull";
import { BlessedUIManager } from "../lib/ui/blessed/blessed-ui-manager";
import { ConsoleManager } from "../lib/ui/console/console-manager";
import { ProgressTracker } from "../lib/ui/progress/progress-tracker";
import { fileOperations } from "./fileOperations";

/**
 * UI Coordinator for Pull operations
 * Handles all UI lifecycle management and delegates business logic to Pull class
 */
export class PullUICoordinator {
  private pull: Pull;
  private blessedUI?: BlessedUIManager;
  private consoleManager?: ConsoleManager;
  private progressTracker?: ProgressTracker;

  constructor() {
    this.pull = new Pull();
    this.initializeUIServices();
  }

  private initializeUIServices(): void {
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
    
    // Initialize UI services based on mode
    if (state.useBlessed) {
      this.blessedUI = new BlessedUIManager({
        title: 'Agility CLI - Pull Progress',
        steps: state.elements.split(','),
        enableAutoExit: true,
        autoExitDelay: 5
      });
    } else {
      // For all non-blessed modes, use console manager and progress tracker
      this.consoleManager = new ConsoleManager();
      this.progressTracker = new ProgressTracker('Pull');
    }
  }

  private async initializeUI(): Promise<void> {
    const state = getState();
    
    if (state.useBlessed && this.blessedUI) {
      // Let BlessedUI handle its own setup and console redirection automatically
      this.blessedUI.setup();
    } else if (this.consoleManager) {
      // Setup console manager for non-blessed modes
      const tempFileOps = new fileOperations(
        state.rootPath, 
        state.sourceGuid[0] || 'temp', 
        state.locale[0] || 'en-us', 
        state.preview
      );
      
      this.consoleManager.setupMode(
        state.useHeadless ? 'headless' : 
        state.useVerbose ? 'verbose' : 'plain',
        tempFileOps
      );
    }
    
    if (this.progressTracker) {
      this.progressTracker.initializeSteps(state.elements.split(','));
    }
  }

  async execute(): Promise<void> {
    try {
      // Initialize UI services
      await this.initializeUI();

      // Execute the pull operation (pure business logic)
      const result = await this.pull.pullInstances();

      // Show completion summary
      await this.showCompletionSummary(result);

    } catch (error: any) {
      console.error(ansiColors.red("\n❌ An error occurred during the pull command:"), error);
      this.cleanup();
      process.exit(1);
    }
  }

  private async showCompletionSummary(result: { success: boolean; results: any[]; elapsedTime: number }): Promise<void> {
    const state = getState();
    const totalElapsedSeconds = Math.floor(result.elapsedTime / 1000);
    const minutes = Math.floor(totalElapsedSeconds / 60);
    const seconds = totalElapsedSeconds % 60;
    const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    // Collect log file paths
    const logFilePaths: string[] = [];
    let totalSuccessful = 0;
    let totalFailed = 0;
    
    result.results.forEach(res => {
      // Count success/failure at GUID+locale level
      if (res.failed?.length > 0) {
        totalFailed++;
      } else {
        totalSuccessful++;
      }
      
      // Collect log file paths
      if (res.logFilePath) {
        logFilePaths.push(res.logFilePath);
      }
    });
    
    const summaryMessage = `Pull completed: ${totalSuccessful}/${result.results.length} successful, ${totalFailed} errors, ${timeDisplay}`;
    
    if (state.useBlessed && this.blessedUI) {
      // Let BlessedUI handle completion display and auto-exit
      this.blessedUI.log("----------------------------------------------------------------------");
      this.blessedUI.log(summaryMessage);
      if (logFilePaths.length > 0) {
        this.blessedUI.log(`Log files: ${logFilePaths.join(', ')}`);
      }
      this.blessedUI.log("Press any key to exit or wait for auto-exit...");
      this.blessedUI.startAutoExit();
    } else {
      // Show completion in console
      console.log(ansiColors.cyan('\nSummary:'));
      console.log(`Processed ${result.results.length} GUID/locale combinations`);
      console.log(`${totalSuccessful} successful, ${totalFailed} failed`);
      console.log(`Total time: ${timeDisplay}`);
      
      // Display log file paths
      if (logFilePaths.length > 0) {
        console.log(ansiColors.cyan('\nLog Files:'));
        logFilePaths.forEach(logPath => {
          console.log(logPath);
        });
      }
      
      console.log(ansiColors.green(summaryMessage));
      
      // Clean up and exit
      this.cleanup();
      process.exit(0);
    }
  }

  private cleanup(): void {
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