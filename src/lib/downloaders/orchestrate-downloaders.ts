import { getState } from '../../core/state';
import { fileOperations } from '../../core/fileOperations';
import ansiColors from 'ansi-colors';
import { DownloadOperationsRegistry, OperationConfig } from './download-operations-config';

export interface DownloadResults {
  successful: string[];
  failed: Array<{ operation: string; error: string }>;
  skipped: string[];
  totalDuration: number;
  guidProcessed: string;
  logFilePath?: string;
}

export interface DownloadOrchestratorConfig {
  operationName?: string;
  onOperationStart?: (operationName: string, guid: string) => void;
  onOperationComplete?: (operationName: string, guid: string, success: boolean) => void;
  onOperationProgress?: (operationName: string, guid: string, percentage: number) => void;
  onOverallProgress?: (processed: number, total: number) => void;
}

export class DownloadOrchestrator {
  private config: DownloadOrchestratorConfig;
  private startTime: Date = new Date();

  constructor(config: DownloadOrchestratorConfig = {}) {
    this.config = config;
  }

  /**
   * Execute all operations for a single GUID
   */
  async guidDownloader(guid: string): Promise<DownloadResults> {
    const startTime = Date.now();
    
    // Create isolated state snapshot for this download
    const globalState = getState();
    const isolatedState = {
      ...globalState,
      // Override with instance-specific values to prevent race conditions
      sourceGuid: [guid],  // Isolate to this specific GUID
      targetGuid: [],      // Clear target to avoid conflicts
    };
    
    const results: DownloadResults = {
      successful: [],
      failed: [],
      skipped: [],
      totalDuration: 0,
      guidProcessed: guid,
    };

    try {
      console.log(`Processing ${guid}...`);

      // Execute all data elements for this GUID
      await this.downloadDataElements(guid, results, isolatedState);

      // Calculate final duration
      results.totalDuration = Date.now() - startTime;

      // Create fileOperations instance for log finalization
      const fileOps = new fileOperations(guid);
      
      try {
        const logFilePath = fileOps.finalizeLogFile("pull");
        results.logFilePath = logFilePath;
        if (isolatedState.useVerbose) {
          console.log(`${guid}: Log file written to ${logFilePath}`);
        }
      } catch (logError: any) {
        console.error(`${guid}: Could not finalize log file - ${logError.message}`);
      }

      const duration = Math.floor(results.totalDuration / 1000);
      console.log(`${guid}: Completed in ${duration}s`);

      return results;

    } catch (error: any) {
      results.failed.push({ operation: 'guid-orchestration', error: error.message });
      results.totalDuration = Date.now() - startTime;
      console.error(`${guid}: Failed - ${error.message}`);
      
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
   * Orchestrate multiple GUIDs concurrently (DEFAULT METHOD)
   */
  async guidOrchestrator(): Promise<DownloadResults[]> {
    const state = getState();
    const allGuids = [...state.sourceGuid, ...state.targetGuid];
    
    if (allGuids.length === 0) {
      throw new Error('No GUIDs available for download operation');
    }
    
    console.log(`Starting parallel downloads for ${allGuids.length} GUID(s): ${allGuids.join(', ')}`);
    
    // Start ALL downloads simultaneously (true parallel execution)
    const startTime = Date.now();
    const downloadTasks = allGuids.map(guid => this.guidDownloader(guid));
    
    const results = await Promise.allSettled(downloadTasks);
    const totalElapsed = Date.now() - startTime;
    
    // Process results and separate successful from failed
    const successfulResults: DownloadResults[] = [];
    const failedResults: Array<{ guid: string; error: string }> = [];
    
    allGuids.forEach((guid, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        successfulResults.push(result.value);
      } else {
        failedResults.push({ 
          guid, 
          error: result.reason?.message || 'Unknown error' 
        });
        console.error(`Failed download: ${guid} - ${result.reason?.message}`);
      }
    });
    
    // Report parallel execution summary
    const totalElapsedSeconds = Math.floor(totalElapsed / 1000);
    
    console.log(`\n📊 Parallel Download Summary:`);
    console.log(`   ${ansiColors.green('✓')} Successful: ${successfulResults.length}/${allGuids.length}`);
    if (failedResults.length > 0) {
      console.log(`   ${ansiColors.red('✗')} Failed: ${failedResults.length}/${allGuids.length}`);
      failedResults.forEach(result => {
        console.log(`     • ${result.guid}: ${result.error}`);
      });
    }
    console.log(`   ⏱️  Total Duration: ${totalElapsedSeconds}s`);
    
    return successfulResults;
  }

  /**
   * Execute specific data elements for a GUID
   */
  private async downloadDataElements(
    guid: string, 
    results: DownloadResults,
    isolatedState: any
  ): Promise<void> {
    // Get operations based on elements filter
    const operations = DownloadOperationsRegistry.getOperationsForElements(isolatedState.elements);

    console.log(`${guid}: Processing ${operations.length} data element(s)...`);

    // Execute each operation
    for (const operation of operations) {
      try {
        this.config.onOperationStart?.(operation.name, guid);
        
        await operation.handler(guid, isolatedState);
        
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
   * Execute downloads for a specific GUID (alias for guidDownloader for backward compatibility)
   */
  async executeDownloads(guid?: string): Promise<DownloadResults> {
    const state = getState();
    const targetGuid = guid || (state.sourceGuid.length > 0 ? state.sourceGuid[0] : '');
    
    if (!targetGuid) {
      throw new Error('No GUID provided for download operation');
    }

    return await this.guidDownloader(targetGuid);
  }

  /**
   * Execute all downloads for all GUIDs (alias for guidOrchestrator for backward compatibility)
   */
  async executeAllDownloadsConcurrently(): Promise<DownloadResults[]> {
    return await this.guidOrchestrator();
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
      console.log(`Starting ${operationName} for ${guid}`);
    },
    onOperationProgress: (operationName, guid, percentage) => {
      onProgress?.(operationName, percentage);
    }
  });

  return await orchestrator.executeDownloads(guid);
}

/**
 * Execute all downloads for all GUIDs concurrently (RECOMMENDED)
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
