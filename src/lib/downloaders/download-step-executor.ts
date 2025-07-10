import { getState } from '../../core/state';
import { fileOperations } from '../../core/fileOperations';
import { StepExecutionContext } from '../ui/progress/step-status-manager';
import { ProgressCallbackType } from '../ui/progress/progress-tracker';

export interface StepExecutionResult {
  stepName: string;
  success: boolean;
  error?: string;
  duration: number;
  itemsProcessed?: number;
}

export interface StepExecutionOptions {
  retryCount?: number;
  retryDelay?: number;
  skipOnError?: boolean;
  logProgress?: boolean;
}

export class DownloadStepExecutor {
  private options: StepExecutionOptions;

  constructor(options: StepExecutionOptions = {}) {
    this.options = {
      retryCount: 2,
      retryDelay: 1000,
      skipOnError: false,
      logProgress: true,
      ...options
    };
  }

  /**
   * Execute a download step with error handling and retry logic
   */
  async executeStep(
    stepName: string,
    stepContext: StepExecutionContext,
    fileOps: fileOperations,
    downloaderFunction: (
      multibar: any,
      fileOps: fileOperations,
      update: boolean,
      progressCallback?: ProgressCallbackType
    ) => Promise<void>
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();
    const state = getState();
    let lastError: Error | null = null;
    let attempt = 0;
    
    while (attempt <= (this.options.retryCount || 0)) {
      try {
        if (attempt > 0) {
          console.log(`📡 Retrying ${stepName} (attempt ${attempt + 1}/${(this.options.retryCount || 0) + 1})`);
          await this.delay(this.options.retryDelay || 1000);
        }

        if (this.options.logProgress) {
          console.log(`🔄 Starting ${stepName}...`);
        }

        // Execute the downloader function
        await downloaderFunction(
          null, // multibar not used in new architecture
          fileOps,
          state.update,
          stepContext.progressCallback
        );

        // Success
        const duration = Date.now() - startTime;
        
        if (this.options.logProgress) {
          console.log(`✅ ${stepName} completed successfully (${duration}ms)`);
        }

        return {
          stepName,
          success: true,
          duration
        };

      } catch (error: any) {
        lastError = error;
        attempt++;
        
        if (this.options.logProgress) {
          console.warn(`⚠️ ${stepName} failed (attempt ${attempt}): ${error.message}`);
        }

        // If we've exhausted retries, break
        if (attempt > (this.options.retryCount || 0)) {
          break;
        }
      }
    }

    // All retries failed
    const duration = Date.now() - startTime;
    const errorMessage = lastError?.message || 'Unknown error';
    
    if (this.options.logProgress) {
      console.error(`❌ ${stepName} failed after ${attempt} attempts: ${errorMessage}`);
    }

    if (this.options.skipOnError) {
      console.log(`⏭️ Skipping ${stepName} due to skipOnError option`);
      return {
        stepName,
        success: false,
        error: errorMessage,
        duration
      };
    }

    throw new Error(`${stepName} failed: ${errorMessage}`);
  }

  /**
   * Execute a batch of steps with parallel processing
   */
  async executeStepsBatch(
    stepExecutions: Array<{
      stepName: string;
      stepContext: StepExecutionContext;
      fileOps: fileOperations;
      downloaderFunction: (
        multibar: any,
        fileOps: fileOperations,
        update: boolean,
        progressCallback?: ProgressCallbackType
      ) => Promise<void>;
    }>,
    maxConcurrency: number = 3
  ): Promise<StepExecutionResult[]> {
    const results: StepExecutionResult[] = [];
    const executing: Promise<StepExecutionResult>[] = [];

    for (const execution of stepExecutions) {
      // Wait if we've reached max concurrency
      if (executing.length >= maxConcurrency) {
        const result = await Promise.race(executing);
        results.push(result);
        
        // Remove completed promise from executing array
        const index = executing.findIndex(p => p === Promise.resolve(result));
        if (index > -1) {
          executing.splice(index, 1);
        }
      }

      // Start next execution
      const promise = this.executeStep(
        execution.stepName,
        execution.stepContext,
        execution.fileOps,
        execution.downloaderFunction
      );
      
      executing.push(promise);
    }

    // Wait for all remaining executions to complete
    const remainingResults = await Promise.all(executing);
    results.push(...remainingResults);

    return results;
  }

  /**
   * Execute Content Sync SDK step with special handling
   */
  async executeContentSyncStep(
    stepContext: StepExecutionContext,
    fileOps: fileOperations,
    syncSDKFunction: (
      multibar: any,
      fileOps: fileOperations,
      update: boolean,
      progressCallback?: ProgressCallbackType
    ) => Promise<void>
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();
    const state = getState();

    try {
      if (this.options.logProgress) {
        console.log(`🔄 Starting Content Sync SDK download...`);
      }

      // Content Sync SDK has its own progress tracking
      let lastProgressUpdate = 0;
      const PROGRESS_UPDATE_INTERVAL = 500;

      const contentProgressCallback: ProgressCallbackType = (processed, total, status) => {
        const now = Date.now();
        
        if (status === "success" || status === "error") {
          stepContext.progressCallback(processed, total, status);
        } else if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
          stepContext.progressCallback(processed, total, status);
          lastProgressUpdate = now;
        }
      };

      await syncSDKFunction(
        null, // multibar not used
        fileOps,
        state.update,
        contentProgressCallback
      );

      const duration = Date.now() - startTime;
      
      if (this.options.logProgress) {
        console.log(`✅ Content Sync SDK completed successfully (${duration}ms)`);
      }

      return {
        stepName: 'Content',
        success: true,
        duration
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMessage = error.message || 'Content Sync SDK failed';
      
      if (this.options.logProgress) {
        console.error(`❌ Content Sync SDK failed: ${errorMessage}`);
      }

      return {
        stepName: 'Content',
        success: false,
        error: errorMessage,
        duration
      };
    }
  }

  /**
   * Execute steps handled by Content Sync SDK (Pages, Sitemaps, Redirections)
   */
  async executeContentSyncManagedStep(
    stepName: string,
    stepContext: StepExecutionContext
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();

    try {
      if (this.options.logProgress) {
        console.log(`📝 ${stepName} is managed by Content Sync SDK`);
      }

      // Simulate brief processing time
      await this.delay(100);
      
      // Mark as complete
      stepContext.updateProgress(100);

      const duration = Date.now() - startTime;
      
      if (this.options.logProgress) {
        console.log(`✅ ${stepName} handled by Content Sync SDK (${duration}ms)`);
      }

      return {
        stepName,
        success: true,
        duration
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMessage = error.message || `${stepName} processing failed`;
      
      return {
        stepName,
        success: false,
        error: errorMessage,
        duration
      };
    }
  }

  /**
   * Get step execution strategy based on step name
   */
  getStepExecutionStrategy(stepName: string): 'direct' | 'content-sync' | 'content-sync-managed' {
    if (stepName === 'Content') {
      return 'content-sync';
    }
    
    if (['Pages', 'Sitemaps', 'Redirections'].includes(stepName)) {
      return 'content-sync-managed';
    }
    
    return 'direct';
  }

  /**
   * Create a progress callback with error handling
   */
  createSafeProgressCallback(stepContext: StepExecutionContext): ProgressCallbackType {
    return (processed: number, total: number, status = "progress") => {
      try {
        stepContext.progressCallback(processed, total, status);
      } catch (error: any) {
        console.warn(`Progress callback error for ${stepContext.stepName}: ${error.message}`);
      }
    };
  }

  /**
   * Validate step execution prerequisites
   */
  validateStepPrerequisites(stepName: string, fileOps: fileOperations): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    
    // Check if fileOps is properly configured
    if (!fileOps) {
      errors.push('FileOperations instance is required');
    }

    // Check step-specific prerequisites
    const state = getState();
    
    if (stepName === 'Content' && !state.sourceGuid) {
      errors.push('Source GUID is required for Content step');
    }

    if (stepName === 'Assets' && !state.sourceGuid) {
      errors.push('Source GUID is required for Assets step');
    }

    // Check if necessary directories exist
    try {
      if (fileOps) {
        // Basic validation that fileOps can access its base path
        // The actual directory creation will be handled by the fileOperations class
        if (!fileOps.cliFolderExists()) {
          // This is just a warning, not an error - the folder will be created during execution
          console.warn('Target directory does not exist yet (will be created during execution)');
        }
      }
    } catch (error: any) {
      errors.push(`Directory validation failed: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get estimated duration for a step
   */
  getEstimatedStepDuration(stepName: string): number {
    const durations: Record<string, number> = {
      'Galleries': 2000,
      'Assets': 10000,
      'Models': 3000,
      'Templates': 2000,
      'Containers': 5000,
      'Content': 30000, // Content Sync SDK is usually the longest
      'Sitemaps': 1000,
      'Redirections': 1000,
      'Pages': 3000
    };

    return durations[stepName] || 5000;
  }

  /**
   * Update execution options
   */
  updateOptions(options: Partial<StepExecutionOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current execution options
   */
  getOptions(): StepExecutionOptions {
    return { ...this.options };
  }

  /**
   * Delay utility for retries
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 