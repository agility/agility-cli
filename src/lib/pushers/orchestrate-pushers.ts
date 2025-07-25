import { getState } from '../../core/state';
import { fileOperations } from '../../core/fileOperations';
import ansiColors from 'ansi-colors';
import { GuidDataLoader, GuidEntities, ModelFilterOptions } from './guid-data-loader';
import { PusherResult, SourceData } from '../../types/sourceData';
import { state } from '../../core/state';
import { PUSH_OPERATIONS, PushOperationsRegistry, PushOperationConfig } from './push-operations-config';

export interface PushResults {
  successful: string[];
  failed: Array<{ operation: string; error: string }>;
  skipped: string[];
  totalDuration: number;
  sourceGuidProcessed: string;
  targetGuidProcessed: string;
  logFilePath?: string;
  totalSuccess: number;
  totalFailures: number;
  totalSkipped: number;
  publishableContentIds: number[];
  publishablePageIds: number[];

}

export interface PusherConfig {
  onOperationStart?: (operationName: string, sourceGuid: string, targetGuid: string) => void;
  onOperationComplete?: (operationName: string, sourceGuid: string, targetGuid: string, success: boolean) => void;
}
// export interface Pushers {
//   pushInstances(): Promise<PushResults>;
// }



export class Pushers {
  private config: PusherConfig;
  private startTime: Date = new Date();
  private fileOps: fileOperations;

  constructor(config: PusherConfig = {}) {
    this.config = config;
    this.fileOps = new fileOperations(state.sourceGuid[0], null);
  }

  /**
   * Execute all push operations for source to target GUID
   */
  async guidPusher(sourceGuid: string, targetGuid: string, locale: string): Promise<PushResults> {
    const startTime = Date.now();

    const results: PushResults = {
      successful: [],
      failed: [],
      skipped: [],
      totalDuration: 0,
      sourceGuidProcessed: sourceGuid,
      targetGuidProcessed: targetGuid,
      totalSuccess: 0,
      totalFailures: 0,
      totalSkipped: 0,
      publishableContentIds: [],
      publishablePageIds: []
    };

    try {
      console.log(`Processing push operations from ${sourceGuid} to ${targetGuid}...`);

      // Load source and target data
      const sourceDataLoader = new GuidDataLoader(sourceGuid, locale);
      const targetDataLoader = new GuidDataLoader(targetGuid, locale);

      // Prepare model filtering options from state
      const state = getState();
      let filterOptions: ModelFilterOptions = {};
      if (state.models && state.models.trim().length > 0) {
        filterOptions.models = state.models.split(',').map(m => m.trim());
      }
      if (state.modelsWithDeps && state.modelsWithDeps.trim().length > 0) {
        filterOptions.modelsWithDeps = state.modelsWithDeps.split(',').map(m => m.trim());
      }

      const { guidEntities: sourceData, locale: sourceLocale } = await sourceDataLoader.loadGuidEntitiesForAllLocales(
        Object.keys(filterOptions).length > 0 ? filterOptions : undefined
      );
      const { guidEntities: targetData, locale: targetLocale } = await targetDataLoader.loadGuidEntitiesForAllLocales();


      console.log(ansiColors.gray(`Executing pushers in order for ${locale}...`));
      // Execute all push operations for this GUID pair
      const pushResults = await this.executePushersInOrder(sourceData, targetData, locale);

      // Consolidate results
      results.totalSuccess = pushResults.totalSuccess;
      results.totalFailures = pushResults.totalFailures;
      results.totalSkipped = pushResults.totalSkipped;
      results.publishableContentIds = pushResults.publishableContentIds;
      results.publishablePageIds = pushResults.publishablePageIds;

      // Calculate final duration
      results.totalDuration = Date.now() - startTime;

      try {
        const logFilePath = this.fileOps.finalizeLogFile("push");
        results.logFilePath = logFilePath;
      } catch (logError: any) {
        console.error(`${sourceGuid}→${targetGuid}: Could not finalize log file - ${logError.message}`);
      }

      const duration = Math.floor(results.totalDuration / 1000);
      console.log(`${sourceGuid}→${targetGuid}: Completed in ${duration}s`);

      return results;

    } catch (error: any) {
      results.failed.push({ operation: 'guid-orchestration', error: error.message });
      results.totalDuration = Date.now() - startTime;
      console.error(`${sourceGuid}→${targetGuid}: Failed - ${error.message}`);

      // Try to finalize log file even on error
      try {
        const logFilePath = this.fileOps.finalizeLogFile("push");
        results.logFilePath = logFilePath;
      } catch (logError: any) {
        console.error(`${sourceGuid}→${targetGuid}: Could not finalize log file - ${logError.message}`);
      }

      return results;
    }
  }

  /**
   * Orchestrate push operations (MAIN METHOD)
   */
  async instanceOrchestrator(): Promise<PushResults[]> {
    const { elements, sourceGuid: sourceGuids, targetGuid: targetGuids, locale: locales } = getState();

    if (sourceGuids.length === 0 || targetGuids.length === 0) {
      throw new Error('No source or target GUIDs available for push operation');
    }

    // For now, handle single source to single target (most common case)
    // Future enhancement: handle multiple source/target combinations
    const sourceGuid = sourceGuids[0];
    const targetGuid = targetGuids[0];

    console.log(`Starting push operations from ${sourceGuid} to ${targetGuid}`);
    console.log(`Elements: ${elements}`);

    let pushResults: PushResults[] = [];

    for (var locale of locales) {
      console.log(`Processing locale: ${locale}`);
      const result = await this.guidPusher(sourceGuid, targetGuid, locale);
      pushResults.push(result);
    }

    return pushResults;
  }

  /**
   * Execute pushers in dependency order - moved from sync.ts
   */
  private async executePushersInOrder(
    sourceData: GuidEntities,
    targetData: GuidEntities,
    locale: string
  ): Promise<{
    totalSuccess: number;
    totalFailures: number;
    totalSkipped: number;
    publishableContentIds: number[];
    publishablePageIds: number[];
  }> {
    const currentState = getState();
    const elements = currentState.elements.split(',');


    console.log(ansiColors.gray(`Executing pushers in order for ${locale}...`));
    // Initialize results tracking
    let totalSuccess = 0;
    let totalFailures = 0;
    let totalSkipped = 0;
    const publishableContentIds: number[] = [];
    const publishablePageIds: number[] = [];

    // DEPENDENCY-OPTIMIZED ORDER: Galleries → Assets → Models → Containers → Content → Templates → Pages
    const pusherConfig = [
      PUSH_OPERATIONS.galleries,
      PUSH_OPERATIONS.assets,
      PUSH_OPERATIONS.models,
      PUSH_OPERATIONS.containers,
      PUSH_OPERATIONS.content,
      PUSH_OPERATIONS.templates,
      PUSH_OPERATIONS.pages
    ];

    try {
      for (const config of pusherConfig) {
        // Get the specific data array for this element type
        const elementData = sourceData[config.dataKey as keyof GuidEntities] || [];

        // Skip if no data for this element type or element not requested
        if (Array.isArray(elementData) && elementData.length === 0 || !elements.some(element => config.elements.includes(element))) {
          console.log(ansiColors.gray(`Skipping ${config.description} - no data or not requested`));
          continue;
        }

        this.config.onOperationStart?.(config.name, state.sourceGuid[0], state.targetGuid[0]);

        const pusherResult: PusherResult = await config.handler(sourceData, targetData, locale);

        // Accumulate results using standardized pattern
        totalSuccess += pusherResult.successful || 0;
        totalSkipped += pusherResult.skipped || 0;
        totalFailures += pusherResult.failed || 0;

        // Collect publishable IDs for auto-publishing
        if (pusherResult.publishableIds && pusherResult.publishableIds.length > 0) {
          if (config.elements.includes('Content')) {
            publishableContentIds.push(...pusherResult.publishableIds);
          } else if (config.elements.includes('Pages')) {
            publishablePageIds.push(...pusherResult.publishableIds);
          }
        }

        // Report individual pusher results
        const successfulColor = pusherResult.successful > 0 ? ansiColors.green : ansiColors.gray;
        const failedColor = pusherResult.failed > 0 ? ansiColors.red : ansiColors.gray;
        const skippedColor = pusherResult.skipped > 0 ? ansiColors.yellow : ansiColors.gray;

        console.log(
          ansiColors.gray(`\n${config.description}: `) +
          successfulColor(`${pusherResult.successful} successful, `) +
          skippedColor(`${pusherResult.skipped} skipped, `) +
          failedColor(`${pusherResult.failed} failed\n`)
        );

        this.config.onOperationComplete?.(config.name, state.sourceGuid[0], state.targetGuid[0], pusherResult.status === 'success');

        // Save mappings after each pusher
        // await referenceMapper.saveAllMappings();

      }

      return {
        totalSuccess,
        totalFailures,
        totalSkipped,
        publishableContentIds,
        publishablePageIds,
      };
    } catch (error) {
      console.error(ansiColors.red("Error during pusher execution:"), error);
      throw error;
    }
  }



  /**
   * Get push summary
   */
  getPushSummary(): {
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
  updateConfig(config: Partial<PusherConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

