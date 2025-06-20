import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { fileOperations } from '../services/fileOperations';
import { ReferenceMapper } from '../utilities/reference-mapper';
import { SourceDataLoader } from '../utilities/source-data-loader';
import { getState } from './state';
import { PusherResult } from '../../types/sourceData';

/**
 * Simplified Sync Operation - Cleaned up from 2000+ line monolithic implementation
 * 
 * Focuses on core sync functionality without complex topological analysis.
 * Uses modular services and centralized state management.
 */
export class Sync {
  private fileOps: fileOperations;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;

  constructor() {
    const state = getState();
    this.fileOps = new fileOperations(state.rootPath, state.sourceGuid, state.locale, state.preview);
    
    // Store original console methods for restoration
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
  }

  /**
   * Log messages to file with timestamp
   */
  private _logToFile(message: string, isError: boolean = false): void {
    const timestamp = new Date().toISOString();
    const logType = isError ? 'ERROR' : 'INFO';
    const logEntry = `[${timestamp}] [${logType}] ${message}\n`;
    this.fileOps.appendLogFile(logEntry);
  }

  /**
   * Set up console logging to capture all output to file
   */
  private _setupConsoleLogging(): void {
    console.log = (...args: any[]) => {
      const message = args.map(arg => String(arg)).join(' ');
      this.originalConsoleLog(...args);
      this._logToFile(message);
    };

    console.error = (...args: any[]) => {
      const message = args.map(arg => String(arg)).join(' ');
      this.originalConsoleError(...args);
      this._logToFile(message, true);
    };
  }

  /**
   * Restore original console methods
   */
  private _restoreConsole(): void {
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
  }

  /**
   * Main sync execution method - simplified from massive topological implementation
   */
  async syncInstance(): Promise<void> {
    this._setupConsoleLogging();
    
    let referenceMapper: ReferenceMapper | null = null;

    try {
      const state = getState();
      console.log(ansiColors.cyan(`\n🔄 Starting sync operation...`));
      console.log(ansiColors.gray(`Source: ${state.sourceGuid}`));
      console.log(ansiColors.gray(`Target: ${state.targetGuid}`));
      console.log(ansiColors.gray(`Elements: ${state.elements}`));

      // Load source data using centralized loader
      console.log(ansiColors.cyan(`\n📥 Loading source data...`));
      const sourceDataLoader = new SourceDataLoader();
      const sourceData = await sourceDataLoader.loadSourceEntities();

      // Check if we have any content to sync
      const hasContent = Object.values(sourceData).some((arr: any) => Array.isArray(arr) && arr.length > 0);
      if (!hasContent) {
        console.log(ansiColors.yellow("⚠️ No content found to sync"));
        return;
      }

      // Set up reference mapper - gets config from state internally
      referenceMapper = new ReferenceMapper();

      // Execute sync operation and capture results
      const syncResults = await this.executePushersInOrder(sourceData, referenceMapper, state.elements.split(","));

      // Calculate and report comprehensive summary statistics
      const elements = state.elements.split(",");
      const totalSourceEntities: number = elements.reduce((total: number, elementType: string) => {
        switch (elementType) {
          case "Models":
            return total + sourceData.models.length;
          case "Galleries":
            return total + sourceData.galleries.length;
          case "Assets":
            return total + sourceData.assets.length;
          case "Containers":
            return total + sourceData.containers.length;
          case "Content":
            return total + sourceData.content.length;
          case "Templates":
            return total + sourceData.templates.length;
          case "Pages":
            return total + sourceData.pages.length;
          default:
            return total;
        }
      }, 0);

      const reconciliationPercentage: number =
        totalSourceEntities > 0
          ? Math.round(
              ((syncResults.totalSuccess + syncResults.totalSkipped) / totalSourceEntities) * 100
            )
          : 100;

      // Enhanced reporting using sync results
      console.log(ansiColors.cyan(`\n📊 Sync Operation Summary:`));
      console.log(
        ansiColors.gray(`Total Source Entities: ${ansiColors.white(totalSourceEntities.toString())}, `) +
          ansiColors.gray(`Success: ${ansiColors.green(syncResults.totalSuccess.toString())}, `) +
          ansiColors.gray(`Skipped: ${ansiColors.white(syncResults.totalSkipped.toString())}, `) +
          ansiColors.gray(`Failed: ${ansiColors.red(syncResults.totalFailures.toString())}, `) +
          ansiColors.gray(`Reconciliation: ${ansiColors.bold.white(reconciliationPercentage.toString() + "%")}`)
      );

      // Report sync status based on results
      if (syncResults.totalFailures > 0) {
        console.log(ansiColors.yellow(`\n⚠️ Sync completed with ${syncResults.totalFailures} failures`));
      } else {
        console.log(ansiColors.green("\n🎉 Sync operation completed successfully!"));
      }

    } catch (error: any) {
      if (referenceMapper) {
        try {
          await referenceMapper.saveAllMappings();
        } catch (saveError) {
          console.error("Failed to save mappings on error:", saveError);
        }
      }

      console.error(ansiColors.red(`❌ Error during sync: ${error.message}`));
      process.exit(1);
    } finally {
      this._restoreConsole();

      try {
        const finalizedLogPath = this.fileOps.finalizeLogFile("sync");
        this.originalConsoleLog(`\n📄 Sync log file written to: ${finalizedLogPath}\n`);
      } catch (logError) {
        this.originalConsoleError("Warning: Could not finalize sync log file:", logError);
      }
    }
  }

  /**
   * Execute pushers in dependency order with embedded function configuration
   */
  private async executePushersInOrder(
    sourceData: any,
    referenceMapper: ReferenceMapper,
    elements: string[]
  ): Promise<{
    totalSuccess: number;
    totalFailures: number;
    totalSkipped: number;
  }> {
    // Import all pushers for embedded configuration
    const { pushModels, pushGalleries, pushAssets, pushContainers, pushContent, pushTemplates, pushPages } = await import('../pushers');

    // Initialize results tracking
    let totalSuccess = 0;
    let totalFailures = 0;
    let totalSkipped = 0;

    // ULTIMATE OPTIMIZATION: Embed functions directly in config (eliminates separate map)
    const pusherConfig = [
      { element: 'Models', dataKey: 'models', name: 'Models', pusher: pushModels },
      { element: 'Galleries', dataKey: 'galleries', name: 'Galleries', pusher: pushGalleries },
      { element: 'Assets', dataKey: 'assets', name: 'Assets', pusher: pushAssets },
      { element: 'Containers', dataKey: 'containers', name: 'Containers', pusher: pushContainers },
      { element: 'Content', dataKey: 'content', name: 'Content Items', pusher: pushContent },
      { element: 'Templates', dataKey: 'templates', name: 'Templates', pusher: pushTemplates },
      { element: 'Pages', dataKey: 'pages', name: 'Pages', pusher: pushPages }
    ];

    try {
      for (const config of pusherConfig) {
        const data = sourceData[config.dataKey];
        
        // Skip if no data or element not requested
        if (data.length === 0 || !elements.includes(config.element)) {
          continue;
        }

        console.log(ansiColors.cyan(`\n📄 Pushing ${config.name}...`));

        // ULTIMATE OPTIMIZATION: Direct function execution from config with unified parameters
        const pusherResult: PusherResult = await config.pusher(sourceData, referenceMapper);

        // Accumulate results using standardized pattern
        totalSuccess += pusherResult.successful || 0;
        totalSkipped += pusherResult.skipped || 0;
        totalFailures += pusherResult.failed || 0;

        // Report individual pusher results
        console.log(
          ansiColors.gray(`${config.name}: `) +
          ansiColors.green(`${pusherResult.successful} successful, `) +
          ansiColors.white(`${pusherResult.skipped} skipped, `) +
          ansiColors.red(`${pusherResult.failed} failed`)
        );

        // Save mappings after each pusher
        await referenceMapper.saveAllMappings();
      }

      return {
        totalSuccess,
        totalFailures,
        totalSkipped,
      };
    } catch (error) {
      console.error(ansiColors.red("Error during pusher execution:"), error);
      throw error;
    }
  }

} 