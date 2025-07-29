import { DownloadOperationsRegistry } from "./download-operations-config";
import { getState, initializeGuidLogger, finalizeGuidLogger } from "core/state";

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

  constructor(config: DownloaderConfig = {}) {
    this.config = config;
  }

  /**
   * Execute all operations for a single GUID
   */
  async guidDownloader(guid: string): Promise<DownloadResults> {
    const startTime = Date.now();
    
    // Initialize per-GUID logger for true parallel logging (no specific entity type since operations vary)
    const guidLogger = initializeGuidLogger(guid, "pull");
    
    // Log operation header with state information
    if (guidLogger) {
      guidLogger.logOperationHeader();
    }
    
    const results: DownloadResults = {
      successful: [],
      failed: [],
      skipped: [],
      totalDuration: 0,
      guidProcessed: guid,
    };

    try {

      // Execute all data elements for this GUID
      await this.downloadDataElements(guid, results);

      // Calculate final duration
      results.totalDuration = Date.now() - startTime;

      // Finalize the per-GUID logger (this creates the log file)
      try {
        const logFilePath = finalizeGuidLogger(guid);
        if (logFilePath) {
          results.logFilePath = logFilePath;
          // Don't display immediately - will be shown at the end
        }
      } catch (logError: any) {
        console.error(`${guid}: Could not finalize log file - ${logError.message}`);
      }


      return results;

    } catch (error: any) {
      results.failed.push({ operation: 'guid-orchestration', error: error.message });
      results.totalDuration = Date.now() - startTime;
      console.error(`${guid}: Failed - ${error.message}`);
      
      // Try to finalize log file even on error
      try {
        const logFilePath = finalizeGuidLogger(guid);
        if (logFilePath) {
          results.logFilePath = logFilePath;
          console.log(`\n${logFilePath}`); // Display log file path to user even on error
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
  async instanceOrchestrator(): Promise<DownloadResults[]> {
    const state = getState();
    const allGuids = [...state.sourceGuid, ...state.targetGuid];
    
    if (allGuids.length === 0) {
      throw new Error('No GUIDs available for download operation');
    }
     
    // Start ALL downloads simultaneously (true parallel execution)
    const downloadTasks = allGuids.map(guid => this.guidDownloader(guid));
    
    const results = await Promise.allSettled(downloadTasks);
    
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
    return successfulResults;
  }

  /**
   * Execute specific data elements for a GUID
   */
  private async downloadDataElements(
    guid: string, 
    results: DownloadResults
  ): Promise<void> {
    // Get operations based on elements filter
    const operations = DownloadOperationsRegistry.getOperationsForElements();

    // console.log(`${guid}: Processing ${operations.length} data element(s)...`);

    // Execute each operation
    for (const operation of operations) {
      try {
        this.config.onOperationStart?.(operation.name, guid);
        
        await operation.handler(guid);
        
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
  }

  /**
   * Reset orchestrator state
   */
  reset(): void {
    // this.startTime = new Date();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DownloaderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
