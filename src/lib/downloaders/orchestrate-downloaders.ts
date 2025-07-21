import { getState } from '../../core/state';
import { fileOperations } from '../../core/fileOperations';
import ansiColors from 'ansi-colors';
import { DownloadOperationsRegistry } from './download-operations-config';
import { SyncDelta } from 'lib/shared';

export interface DownloadResults {
  successful: string[];
  failed: Array<{ operation: string; error: string }>;
  skipped: string[];
  totalDuration: number;
  guidProcessed: string;
  logFilePath?: string;
}

export interface DownloaderConfig {
  onOperationStart?: (operationName: string, guid: string) => void;
  onOperationComplete?: (operationName: string, guid: string, success: boolean) => void;
}

export class Downloader {
  private config: DownloaderConfig;
  private startTime: Date = new Date();

  constructor(config: DownloaderConfig = {}) {
    this.config = config;
  }

  /**
   * Execute all operations for a single GUID
   */
  async guidDownloader(guid: string): Promise<DownloadResults> {
    const startTime = Date.now();
    
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
      await this.downloadDataElements(guid, results);

      // Calculate final duration
      results.totalDuration = Date.now() - startTime;

      // Create fileOperations instance for log finalization
      const fileOps = new fileOperations(guid);
      
      try {
        const logFilePath = fileOps.finalizeLogFile("pull");
        results.logFilePath = logFilePath;
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
      } catch (logError: any) {
        console.error(`${guid}: Could not finalize log file - ${logError.message}`);
      }
      
      return results;
    }
  }

  /**
   * Orchestrate multiple GUIDs concurrently (DEFAULT METHOD)
   */
  async instanceOrchestrator(): Promise<DownloadResults[]> {
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
  ): Promise<void> {
    // Get operations based on elements filter
    const operations = DownloadOperationsRegistry.getOperationsForElements();

    // create delta for the operations
    const syncDelta = new SyncDelta(guid);
    console.log(`${guid}: Processing ${operations.length} data element(s)...`);

    // Execute each operation
    for (const operation of operations) {
      try {
        this.config.onOperationStart?.(operation.name, guid);
        
        await operation.handler(guid, syncDelta);
        
        results.successful.push(`${operation.name} (${guid})`);
        this.config.onOperationComplete?.(operation.name, guid, true);
        
      } catch (error: any) {
        console.log(error);
        const errorMessage = error.message || 'Unknown error';
        results.failed.push({ operation: operation.name, error: errorMessage });
        
        this.config.onOperationComplete?.(operation.name, guid, false);
        console.error(`❌ ${guid}: ${operation.name} failed - ${errorMessage}`);
      }
    }

    // TODO: what is the root path?
    syncDelta.writeSyncDelta()
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
  updateConfig(config: Partial<DownloaderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
