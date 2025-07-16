import { getState } from '../../core/state';
import { StepStatusManager, StepExecutionContext } from '../ui/progress/step-status-manager';
import { fileOperations } from '../../core/fileOperations';
import { SyncDeltaTracker } from '../shared/sync-delta-tracker';
import ansiColors from 'ansi-colors';

// Import existing downloaders
import { downloadAllGalleries } from './download-galleries';
import { downloadAllAssets } from './download-assets';
import { downloadAllModels } from './download-models';
import { downloadAllTemplates } from './download-templates';
import { downloadAllContainers } from './download-containers';
import { downloadAllSyncSDK } from './download-sync-sdk';

export interface DownloadResults {
  successful: string[];
  failed: Array<{ step: string; error: string; locale?: string }>;
  skipped: string[];
  totalDuration: number;
  guidProcessed: string;
  localesProcessed: string[];
  logFilePath?: string; // Add log file path to results
}

export interface DownloadOrchestratorConfig {
  operationName?: string;
  onStepStart?: (stepName: string, guid: string) => void;
  onStepComplete?: (stepName: string, guid: string, success: boolean) => void;
  onStepProgress?: (stepName: string, guid: string, percentage: number) => void;
  onOverallProgress?: (processed: number, total: number) => void;
}

export class DownloadOrchestrator {
  private stepStatusManager: StepStatusManager;
  private config: DownloadOrchestratorConfig;
  private startTime: Date = new Date();
  private syncDeltaTracker?: SyncDeltaTracker;

  constructor(config: DownloadOrchestratorConfig = {}) {
    this.config = config;
    this.stepStatusManager = new StepStatusManager(config.operationName || 'Download');
  }

  /**
   * Execute downloads for a specific GUID or use state default
   * Handles multi-locale downloads for each GUID
   */
  async executeDownloads(guid?: string): Promise<DownloadResults> {
    const state = getState();
    const targetGuid = guid || (state.sourceGuid.length > 0 ? state.sourceGuid[0] : '');
    
    if (!targetGuid) {
      throw new Error('No GUID provided for download operation');
    }

    this.startTime = new Date();
    const results: DownloadResults = {
      successful: [],
      failed: [],
      skipped: [],
      totalDuration: 0,
      guidProcessed: targetGuid,
      localesProcessed: []
    };

    try {
      // Use state locales directly, default to en-us if none specified
      const locales = state.locale.length > 0 ? state.locale : ['en-us'];
      results.localesProcessed = locales;

      console.log(`Processing ${locales.length} locale(s) for ${targetGuid}: ${locales.join(', ')}`);

      // Get available steps and filter by elements
      const availableSteps = StepStatusManager.getAvailableSteps();
      const filteredSteps = StepStatusManager.filterStepsByElements(availableSteps);
      const stepConfigs = StepStatusManager.createStepConfigs(filteredSteps);

      // Initialize step status manager
      this.stepStatusManager.initializeSteps(stepConfigs);

      // Execute each step for each locale
      for (const locale of locales) {
        console.log(`Processing locale: ${locale}`);

        for (let i = 0; i < stepConfigs.length; i++) {
          const stepConfig = stepConfigs[i];
          const stepName = stepConfig.name;

          try {
            this.config.onStepStart?.(stepName, targetGuid);
            
            const stepContext = this.stepStatusManager.startStep(i);
            await this.executeStep(stepContext, targetGuid, locale);
            
            stepContext.complete();
            results.successful.push(`${stepName} (${locale})`);
            this.config.onStepComplete?.(stepName, targetGuid, true);
            
          } catch (error: any) {
            const errorMessage = error.message || 'Unknown error';
            results.failed.push({ step: stepName, error: errorMessage, locale });
            
            const stepContext = this.stepStatusManager.startStep(i);
            stepContext.fail(errorMessage);
            this.config.onStepComplete?.(stepName, targetGuid, false);
            
            console.error(`Failed ${stepName} for locale ${locale}: ${errorMessage}`);
          }

          // Report overall progress
          const totalOperations = stepConfigs.length * locales.length;
          const completedOperations = (locales.indexOf(locale) * stepConfigs.length) + (i + 1);
          this.config.onOverallProgress?.(completedOperations, totalOperations);
        }
      }

      // Calculate final duration
      results.totalDuration = Date.now() - this.startTime.getTime();

      return results;

    } catch (error: any) {
      results.failed.push({ step: 'orchestration', error: error.message });
      results.totalDuration = Date.now() - this.startTime.getTime();
      throw error;
    }
  }

  /**
   * Execute downloads for all GUIDs and locales concurrently (DEFAULT METHOD)
   * Creates one parallel download task per GUID+locale combination using per-GUID locale mapping
   */
  async executeAllDownloadsConcurrently(): Promise<DownloadResults[]> {
    const state = getState();
    const allGuids = [...state.sourceGuid, ...state.targetGuid];
    
    if (allGuids.length === 0) {
      throw new Error('No GUIDs available for download operation');
    }
    
    // Calculate total combinations using per-GUID locale mapping
    let totalCombinations = 0;
    const downloadTasks: Promise<DownloadResults>[] = [];
    
    // Create GUID×locale matrix using per-GUID locale mapping
    const downloadOperations: Array<{ guid: string; locale: string }> = [];
    
    for (const guid of allGuids) {
      // Get locales for this specific GUID from the mapping
      const guidLocales = state.guidLocaleMap.get(guid) || ['en-us']; // Fallback if not found
      totalCombinations += guidLocales.length;
      
      for (const locale of guidLocales) {
        downloadOperations.push({ guid, locale });
      }
    }
    
    // console.log(`PARALLEL EXECUTION: Starting ${totalCombinations} downloads simultaneously...`);
    downloadOperations.forEach(({ guid, locale }) => {
      console.log(`${guid} (${locale})`);
    });
    
    // Start ALL downloads simultaneously (true parallel execution)
    const startTime = Date.now();
    downloadOperations.forEach(({ guid, locale }) => {
      const downloadPromise = this.executeSingleInstanceDownload(guid, locale);
      downloadTasks.push(downloadPromise);
    });
    
    const results = await Promise.allSettled(downloadTasks);
    const totalElapsed = Date.now() - startTime;
    
    // Process results and separate successful from failed
    const successfulResults: DownloadResults[] = [];
    const failedResults: Array<{ guid: string; locale: string; error: string }> = [];
    
    let index = 0;
    for (const guid of allGuids) {
      const guidLocales = state.guidLocaleMap.get(guid) || ['en-us'];
      for (const locale of guidLocales) {
        const result = results[index];
        if (result.status === 'fulfilled') {
          successfulResults.push(result.value);
        } else {
          failedResults.push({ 
            guid, 
            locale, 
            error: result.reason?.message || 'Unknown error' 
          });
          console.error(`Failed download: ${guid} (${locale}) - ${result.reason?.message}`);
        }
        index++;
      }
    }
    
    // Report parallel execution summary
    const totalElapsedSeconds = Math.floor(totalElapsed / 1000);
    // console.log(ansiColors.cyan(`\nPARALLEL EXECUTION COMPLETE (${totalElapsedSeconds}s total)`));
    // console.log(ansiColors.green(`Successful: ${successfulResults.length}/${totalCombinations}`));
    
    if (failedResults.length > 0) {
      console.log(ansiColors.red(`❌ Failed: ${failedResults.length}/${totalCombinations}`));
      failedResults.forEach(result => {
        console.log(`   • ${result.guid} (${result.locale}): ${result.error}`);
      });
    }
    
    // Show performance metrics
    if (successfulResults.length > 0) {
      const avgDuration = successfulResults.reduce((sum, r) => sum + r.totalDuration, 0) / successfulResults.length;
      const avgSeconds = Math.floor(avgDuration / 1000);
      // console.log(ansiColors.gray(`Average per download: ${avgSeconds}s`));
    }
    
    return successfulResults;
  }

  /**
   * Execute download for a single GUID+locale combination
   */
  private async executeSingleInstanceDownload(guid: string, locale: string): Promise<DownloadResults> {
    const startTime = Date.now();
    
    // RACE CONDITION FIX: Create isolated state snapshot for this download
    const globalState = getState();
    const isolatedState = {
      ...globalState,
      // Override with instance-specific values to prevent race conditions
      sourceGuid: [guid],  // Isolate to this specific GUID
      targetGuid: [],      // Clear target to avoid conflicts
      locale: [locale],    // Isolate to this specific locale
    };
    
    const results: DownloadResults = {
      successful: [],
      failed: [],
      skipped: [],
      totalDuration: 0,
      guidProcessed: guid,
      localesProcessed: [locale]
    };

    try {
      const instanceStart = Date.now();
      
      // Initialize SyncDeltaTracker for this download session (local to this instance)
      const channel = isolatedState.channel || 'website';
      const syncDeltaTracker = new SyncDeltaTracker(guid, locale, channel);
      
      // Create fileOperations instance for this specific GUID and locale
      const fileOps = new fileOperations(isolatedState.rootPath, guid, locale, isolatedState.preview, isolatedState.legacyFolders);

      // Get filtered steps using isolated state to prevent race conditions
      const availableSteps = StepStatusManager.getAvailableSteps();
      const filteredSteps = this.filterStepsByElementsIsolated(availableSteps, isolatedState.elements);
      const stepConfigs = this.createStepConfigsIsolated(filteredSteps);

      // Execute each step for this specific instance
      for (let i = 0; i < stepConfigs.length; i++) {
        const stepConfig = stepConfigs[i];
        const stepName = stepConfig.name;

        try {
          // Enhanced logging to debug container download issue
          // console.log(`${guid} (${locale}): Starting ${stepName}`);
          
          await this.executeStepForInstanceIsolated(stepConfig, guid, locale, fileOps, isolatedState, syncDeltaTracker);
          
          results.successful.push(`${stepName} (${locale})`);
          
          // console.log(`${guid} (${locale}): ${stepName} completed successfully`);
          
        } catch (error: any) {
          const errorMessage = error.message || 'Unknown error';
          results.failed.push({ step: stepName, error: errorMessage, locale });
          console.error(`❌ ${guid} (${locale}): ${stepName} failed - ${errorMessage}`);
        }
      }

      results.totalDuration = Date.now() - startTime;
      const duration = Math.floor(results.totalDuration / 1000);
      console.log(`${guid} (${locale}): Completed in ${duration}s`);

      // Finalize log file and store the path
      try {
        const logFilePath = fileOps.finalizeLogFile("pull");
        results.logFilePath = logFilePath;
        if (isolatedState.useVerbose) {
          console.log(`${guid} (${locale}): Log file written to ${logFilePath}`);
        }
      } catch (logError: any) {
        console.error(`${guid} (${locale}): Could not finalize log file - ${logError.message}`);
      }

      // Write sync delta report
      if (syncDeltaTracker) {
        try {
          // Only write sync delta for source instances during sync operations
          // This prevents target instance from overwriting source instance changes
          const { getState } = await import('../../core/state');
          const state = getState();
          const isSourceInstance = state.sourceGuid?.includes(guid);
          const isSyncOperation = state.targetGuid && state.targetGuid.length > 0;
          
          if (!isSyncOperation || isSourceInstance) {
            const deltaFilePath = await syncDeltaTracker.writeSyncDelta(isolatedState.rootPath);
            if (isolatedState.useVerbose) {
              const operationType = isSyncOperation ? 'sync' : 'pull';
              console.log(`${guid} (${locale}): ${operationType} delta written to ${deltaFilePath}`);
              // console.log(syncDeltaTracker.getFormattedSummary());
            }
          } else {
            if (isolatedState.useVerbose) {
              console.log(`${guid} (${locale}): Skipping sync delta (target instance in sync operation)`);
            }
          }
        } catch (deltaError: any) {
          console.error(`${guid} (${locale}): Could not write sync delta - ${deltaError.message}`);
        }
      }

      return results;

    } catch (error: any) {
      results.failed.push({ step: 'instance-orchestration', error: error.message, locale });
      results.totalDuration = Date.now() - startTime;
      console.error(`${guid} (${locale}): Instance failed - ${error.message}`);
      
      // Try to finalize log file even on error
      try {
        const fileOps = new fileOperations(isolatedState.rootPath, guid, locale, isolatedState.preview, isolatedState.legacyFolders);
        const logFilePath = fileOps.finalizeLogFile("pull");
        results.logFilePath = logFilePath;
        if (isolatedState.useVerbose) {
          console.log(`${guid} (${locale}): Log file written to ${logFilePath}`);
        }
      } catch (logError: any) {
        console.error(`${guid} (${locale}): Could not finalize log file - ${logError.message}`);
      }
      
      return results;
    }
  }

  /**
   * Filter steps by elements using isolated state (race condition safe)
   */
  private filterStepsByElementsIsolated(availableSteps: string[], elements: string): string[] {
    const elementList = elements ? elements.split(",") : ['Galleries', 'Assets', 'Models', 'Templates', 'Containers', 'Content', 'Pages'];
    
    // Map element names to step names (some elements map to multiple steps)
    const elementToStepMap: Record<string, string[]> = {
      'Galleries': ['downloadAllGalleries'],
      'Assets': ['downloadAllAssets'],
      'Models': ['downloadAllModels'],
      'Templates': ['downloadAllTemplates'],
      'Containers': ['downloadAllContainers', 'downloadAllSyncSDK'], // Run both isolated and sync SDK downloaders
      'Content': ['downloadAllSyncSDK'],
      'Pages': ['downloadAllSyncSDK'],
      'Sitemaps': ['downloadAllSyncSDK'],
      'Redirections': ['downloadAllSyncSDK']
    };
    
    // Convert elements to step names and filter available steps, removing duplicates
    const requiredStepNames = Array.from(new Set(elementList.flatMap(element => elementToStepMap[element] || []).filter(Boolean)));
    return availableSteps.filter(step => requiredStepNames.includes(step));
  }

  /**
   * Create step configurations using isolated state (race condition safe)
   */
  private createStepConfigsIsolated(stepNames: string[]): any[] {
    return stepNames.map(stepName => {
      const config: any = {
        name: stepName,
        weight: this.getStepWeight(stepName),
        description: this.getStepDescription(stepName),
        isOptional: false
      };

      // Add dependencies for certain steps
      if (stepName === "downloadAllSyncSDK") {
        config.dependencies = ["downloadAllModels", "downloadAllContainers"];
      }

      return config;
    });
  }

  /**
   * Get step weight for weighted progress calculation
   */
  private getStepWeight(stepName: string): number {
    const weights: Record<string, number> = {
      "downloadAllSyncSDK": 5,     // Content Sync SDK is usually the heaviest operation
      "downloadAllGalleries": 1,
      "downloadAllAssets": 3,
      "downloadAllModels": 2,
      "downloadAllTemplates": 1,
      "downloadAllContainers": 2
    };
    return weights[stepName] || 1;
  }

  /**
   * Get step description
   */
  private getStepDescription(stepName: string): string {
    const descriptions: Record<string, string> = {
      "downloadAllSyncSDK": "Download content items, pages, sitemaps, and redirections via Content Sync SDK",
      "downloadAllGalleries": "Download asset galleries and media groupings",
      "downloadAllAssets": "Download media files and asset metadata",
      "downloadAllModels": "Download content models and field definitions",
      "downloadAllTemplates": "Download page templates and layouts",
      "downloadAllContainers": "Download content containers and views"
    };
    return descriptions[stepName] || `Download ${stepName}`;
  }

  /**
   * Execute a specific step for a specific instance using isolated state
   */
  private async executeStepForInstanceIsolated(stepConfig: any, guid: string, locale: string, fileOps: fileOperations, isolatedState: any, syncDeltaTracker?: SyncDeltaTracker): Promise<void> {
    const stepName = stepConfig.name;

    switch (stepName) {
      case 'downloadAllSyncSDK':
        await downloadAllSyncSDK(guid, locale, isolatedState.preview, isolatedState.channel, isolatedState.rootPath, isolatedState.update, syncDeltaTracker);
        break;
      
      case 'downloadAllModels':
        await downloadAllModels(fileOps, undefined, syncDeltaTracker);
        break;
      
      case 'downloadAllTemplates':
        await downloadAllTemplates(fileOps);
        break;
      
      case 'downloadAllContainers':
        await downloadAllContainers(fileOps, undefined, syncDeltaTracker);
        break;
      
      case 'downloadAllAssets':
        await downloadAllAssets(fileOps, undefined, syncDeltaTracker);
        break;
      
      case 'downloadAllGalleries':
        await downloadAllGalleries(fileOps, undefined, syncDeltaTracker);
        break;
      
      default:
        throw new Error(`Unknown step: ${stepName}`);
    }
  }

  private async executeStep(stepContext: StepExecutionContext, guid: string, locale?: string): Promise<void> {
    const stepName = stepContext.stepName;
    const state = getState();
    const targetLocale = locale || state.locale[0] || 'en-us';
    
    // Create fileOperations instance for this specific GUID and locale
    const fileOps = new fileOperations(state.rootPath, guid, targetLocale, state.preview, state.legacyFolders);

    switch (stepName) {
      case 'downloadAllSyncSDK':
        await downloadAllSyncSDK(guid, targetLocale, state.preview, state.channel, state.rootPath, state.update);
        break;
      
      case 'downloadAllModels':
        await downloadAllModels(fileOps);
        break;
      
      case 'downloadAllTemplates':
        await downloadAllTemplates(fileOps);
        break;
      
      case 'downloadAllContainers':
        await downloadAllContainers(fileOps);
        break;
      
      case 'downloadAllAssets':
        await downloadAllAssets(fileOps);
        break;
      
      case 'downloadAllGalleries':
        await downloadAllGalleries(fileOps);
        break;
      
      default:
        throw new Error(`Unknown step: ${stepName}`);
    }
  }

  getStepStatusManager(): StepStatusManager {
    return this.stepStatusManager;
  }

  getDownloadSummary(): {
    totalSteps: number;
    successfulSteps: number;
    failedSteps: number;
    overallSuccess: boolean;
    duration: number;
  } {
    const summary = this.stepStatusManager.getExecutionSummary();
    
    return {
      totalSteps: summary.totalSteps,
      successfulSteps: summary.successfulSteps,
      failedSteps: summary.errorSteps,
      overallSuccess: summary.overallSuccess,
      duration: Date.now() - this.startTime.getTime()
    };
  }

  reset(): void {
    this.stepStatusManager = new StepStatusManager(this.config.operationName || 'Download');
    this.startTime = new Date();
  }

  updateConfig(config: Partial<DownloadOrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export function createDownloadOrchestrator(config: DownloadOrchestratorConfig = {}): DownloadOrchestrator {
  return new DownloadOrchestrator(config);
}

export async function executeDownloadsWithProgress(
  guid?: string,
  onProgress?: (step: string, percentage: number) => void
): Promise<DownloadResults> {
  const orchestrator = createDownloadOrchestrator({
    onStepStart: (stepName, guid) => {
      // console.log(`Starting ${stepName} for ${guid}`);
    },
    onStepProgress: (stepName, guid, percentage) => {
      onProgress?.(stepName, percentage);
    }
  });

  return await orchestrator.executeDownloads(guid);
}

/**
 * Execute all downloads for all GUIDs and locales concurrently (RECOMMENDED)
 */
export async function executeAllDownloadsWithProgress(
  onProgress?: (completed: number, total: number) => void
): Promise<DownloadResults[]> {
  const orchestrator = createDownloadOrchestrator({
    onStepStart: (stepName, guid) => {
      console.log(`Starting ${stepName} for ${guid}`);
    },
    onOverallProgress: (completed, total) => {
      onProgress?.(completed, total);
    }
  });

  return await orchestrator.executeAllDownloadsConcurrently();
} 