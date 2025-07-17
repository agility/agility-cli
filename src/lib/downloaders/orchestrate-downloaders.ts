import { getState } from '../../core/state';
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
import { downloadAllSitemaps } from './download-sitemaps';

export interface DownloadResults {
  successful: string[];
  failed: Array<{ operation: string; error: string; locale?: string }>;
  skipped: string[];
  totalDuration: number;
  guidProcessed: string;
  localesProcessed: string[];
  logFilePath?: string;
}

export interface DownloadOrchestratorConfig {
  operationName?: string;
  onOperationStart?: (operationName: string, guid: string) => void;
  onOperationComplete?: (operationName: string, guid: string, success: boolean) => void;
  onOperationProgress?: (operationName: string, guid: string, percentage: number) => void;
  onOverallProgress?: (processed: number, total: number) => void;
}

export interface DownloadOperation {
  name: string;
  execute: (guid: string, isolatedState: any, syncDeltaTracker?: SyncDeltaTracker, locale?: string) => Promise<void>;
  description?: string;
}

export class DownloadOrchestrator {
  private config: DownloadOrchestratorConfig;
  private startTime: Date = new Date();

  constructor(config: DownloadOrchestratorConfig = {}) {
    this.config = config;
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

      // TODO: Execute downloads for guid lovel
      await this.executeDownloadsForGuidLevel(targetGuid, results);

      // Execute downloads for each locale
      for (const locale of locales) {
        console.log(`Processing locale: ${locale}`);
        await this.executeDownloadsForLocale(targetGuid, locale, results);
      }


      // Calculate final duration
      results.totalDuration = Date.now() - this.startTime.getTime();

      return results;

    } catch (error: any) {
      results.failed.push({ operation: 'orchestration', error: error.message });
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
      
      // Initialize SyncDeltaTracker ONLY for source instances during sync operations
      const channel = isolatedState.channel || 'website';
      const { getState } = await import('../../core/state');
      const state = getState();
      const isSourceInstance = state.sourceGuid?.includes(guid);
      const isSyncOperation = state.targetGuid && state.targetGuid.length > 0;
      
      // Only create SyncDeltaTracker for source instances during sync operations
      const syncDeltaTracker = (!isSyncOperation || isSourceInstance) 
        ? new SyncDeltaTracker(guid, locale, channel) 
        : undefined;
      
      // Create fileOperations instance for this specific GUID and locale
      const fileOps = new fileOperations(guid);

      // Execute downloads for this specific instance
      await this.executeDownloadsForLocale(guid, locale, results, isolatedState, syncDeltaTracker);

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

      // Write sync delta report (only source instances have syncDeltaTracker now)
      if (syncDeltaTracker) {
        try {
          const deltaFilePath = await syncDeltaTracker.writeSyncDelta(isolatedState.rootPath);
          if (isolatedState.useVerbose) {
            const operationType = isSyncOperation ? 'sync' : 'pull';
            console.log(`${guid} (${locale}): ${operationType} delta written to ${deltaFilePath}`);
          }
        } catch (deltaError: any) {
          console.error(`${guid} (${locale}): Could not write sync delta - ${deltaError.message}`);
        }
      }

      return results;

    } catch (error: any) {
      results.failed.push({ operation: 'instance-orchestration', error: error.message, locale });
      results.totalDuration = Date.now() - startTime;
      console.error(`${guid}: Instance failed - ${error.message}`);
      
      // Try to finalize log file even on error
      try {
        const fileOps = new fileOperations(guid);
        const logFilePath = fileOps.finalizeLogFile("pull");
        results.logFilePath = logFilePath;
        if (isolatedState.useVerbose) {
          console.log(`${guid}: Log file written to ${logFilePath}`);
        }
      } catch (logError: any) {
        console.error(`${guid}: Could not finalize log file - ${logError.message}`);
      }
      
      return results;
    }
  }

 /**
   * Execute downloads for guid level items (Assets, Models, Containers, URLredirects, Templates)
   * This method can be overridden to customize the download sequence
   */
 protected async executeDownloadsForGuidLevel(
  guid: string, 
  results: DownloadResults,
  isolatedState?: any,
  syncDeltaTracker?: SyncDeltaTracker
): Promise<void> {

  // Use isolated state if provided, otherwise use global state
  const state = isolatedState || getState();

  // Get operations based on elements filter
  const operations = this.getOperationsForElements(state.elements, true);

  // Execute each operation
  for (const operation of operations) {
    try {
      this.config.onOperationStart?.(operation.name, guid);
      
      await operation.execute(guid, state, syncDeltaTracker);
      
      results.successful.push(`${operation.name} (${guid})`);
      this.config.onOperationComplete?.(operation.name, guid, true);
      
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      results.failed.push({ operation: operation.name, error: errorMessage });
      
      this.config.onOperationComplete?.(operation.name, guid, false);
      console.error(`❌ ${guid}: ${operation.name} failed - ${errorMessage}`);
    }
  }
}

  /**
   * Execute downloads for a specific locale
   * This method can be overridden to customize the download sequence
   */
  protected async executeDownloadsForLocale(
    guid: string, 
    locale: string, 
    results: DownloadResults,
    isolatedState?: any,
    syncDeltaTracker?: SyncDeltaTracker
  ): Promise<void> {


    // Use isolated state if provided, otherwise use global state
    const state = isolatedState || getState();

    // Get operations based on elements filter
    const operations = this.getOperationsForElements(state.elements, true);

    // Execute each operation
    for (const operation of operations) {
      try {
        this.config.onOperationStart?.(operation.name, guid);
        await operation.execute(guid, state, syncDeltaTracker, locale);
        results.successful.push(`${operation.name} (${locale})`);
        this.config.onOperationComplete?.(operation.name, guid, true);
        
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        results.failed.push({ operation: operation.name, error: errorMessage, locale });
        this.config.onOperationComplete?.(operation.name, guid, false);
        console.error(`❌ ${guid} (${locale}): ${operation.name} failed - ${errorMessage}`);
      }
    }
  }

  /**
   * Get operations based on elements filter
   */
  private getOperationsForElements(elements?: string, isLocaleOperation?: boolean): DownloadOperation[] {
    const elementList = elements ? elements.split(",") : ['Galleries', 'Assets', 'Models', 'Containers', 'Content', 'Templates', 'Pages', 'Sitemaps', 'Redirections'];
    
    // Map element names to operations
    const elementToOperationMap: Record<string, string[]> = isLocaleOperation ? {
      'Content': ['downloadAllSyncSDK'],
      'Pages': ['downloadAllSyncSDK'],
      'Sitemaps': ['downloadAllSitemaps'],
    } : {
      'Galleries': ['downloadAllGalleries'],
      'Assets': ['downloadAllAssets'],
      'Models': ['downloadAllModels'],
      'Templates': ['downloadAllTemplates'],
      'Containers': ['downloadAllContainers'],
    };
    
    // Convert elements to operation names and remove duplicates
    const requiredOperationNames = Array.from(new Set(elementList.flatMap(element => elementToOperationMap[element] || []).filter(Boolean)));
    
    // Create operation objects
    return requiredOperationNames.map(name => this.createOperation(name));
  }

  /**
   * Create a download operation
   */
  private createOperation(operationName: string): DownloadOperation {
    return {
      name: operationName,
      description: this.getOperationDescription(operationName),
      execute: async (guid: string, isolatedState: any, syncDeltaTracker?: SyncDeltaTracker, locale?: string) => {
        switch (operationName) {
          case 'downloadAllSyncSDK':
            await downloadAllSyncSDK(guid, locale, isolatedState.channel, syncDeltaTracker);
            break;
          
          case 'downloadAllModels':
            await downloadAllModels(guid, syncDeltaTracker);
            break;
          
          case 'downloadAllTemplates':
            await downloadAllTemplates(guid, syncDeltaTracker);
            break;
          
          case 'downloadAllContainers':
            await downloadAllContainers(guid, syncDeltaTracker);
            break;
          
          case 'downloadAllAssets':
            await downloadAllAssets(guid, syncDeltaTracker);
            break;
          
          case 'downloadAllGalleries':
            await downloadAllGalleries(guid, syncDeltaTracker);
            break;
          
          case 'downloadAllSitemaps':
            await downloadAllSitemaps(guid, syncDeltaTracker);
            break;
          
          default:
            throw new Error(`Unknown operation: ${operationName}`);
        }
      }
    };
  }

  /**
   * Get operation description
   */
  private getOperationDescription(operationName: string): string {
    const descriptions: Record<string, string> = {
      "downloadAllSyncSDK": "Download content items, pages, sitemaps, and redirections via Content Sync SDK",
      "downloadAllGalleries": "Download asset galleries and media groupings",
      "downloadAllAssets": "Download media files and asset metadata",
      "downloadAllModels": "Download content models and field definitions",
      "downloadAllTemplates": "Download page templates and layouts",
      "downloadAllContainers": "Download content containers and views",
      "downloadAllSitemaps": "Download sitemaps"
    };
    return descriptions[operationName] || `Download ${operationName}`;
  }

  /**
   * Get download summary
   */
  getDownloadSummary(): {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    overallSuccess: boolean;
    duration: number;
  } {
    return {
      totalOperations: 0, // This would need to be tracked if needed
      successfulOperations: 0,
      failedOperations: 0,
      overallSuccess: true,
      duration: Date.now() - this.startTime.getTime()
    };
  }

  /**
   * Reset orchestrator state
   */
  reset(): void {
    this.startTime = new Date();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DownloadOrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export function createDownloadOrchestrator(config: DownloadOrchestratorConfig = {}): DownloadOrchestrator {
  return new DownloadOrchestrator(config);
}

export async function executeDownloadsWithProgress(
  guid?: string,
  onProgress?: (operation: string, percentage: number) => void
): Promise<DownloadResults> {
  const orchestrator = createDownloadOrchestrator({
    onOperationStart: (operationName, guid) => {
      // console.log(`Starting ${operationName} for ${guid}`);
    },
    onOperationProgress: (operationName, guid, percentage) => {
      onProgress?.(operationName, percentage);
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
    onOperationStart: (operationName, guid) => {
      console.log(`Starting ${operationName} for ${guid}`);
    },
    onOverallProgress: (completed, total) => {
      onProgress?.(completed, total);
    }
  });

  return await orchestrator.executeAllDownloadsConcurrently();
} 
