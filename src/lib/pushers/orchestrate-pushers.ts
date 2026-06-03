import { getState, initializeGuidLogger, finalizeGuidLogger } from "../../core/state";
import { fileOperations } from "../../core/fileOperations";
import ansiColors from "ansi-colors";
import { GuidDataLoader, GuidEntities, ModelFilterOptions } from "./guid-data-loader";
import { PusherResult, SourceData, FailureDetail } from "../../types/sourceData";
import { state } from "../../core/state";
import { PUSH_OPERATIONS, PushOperationsRegistry, PushOperationConfig } from "./push-operations-config";

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
  // Per-locale tracking for proper batch workflow locale handling
  publishableContentIdsByLocale: Map<string, number[]>;
  publishablePageIdsByLocale: Map<string, number[]>;
  // Individual failure details for error summary
  failureDetails: FailureDetail[];
}

export interface PusherConfig {
  onOperationStart?: (operationName: string, sourceGuid: string, targetGuid: string) => void;
  onOperationComplete?: (operationName: string, sourceGuid: string, targetGuid: string, success: boolean) => void;
}

export class Pushers {
  private config: PusherConfig;
  private startTime: Date = new Date();
  private fileOps: fileOperations | null = null;

  constructor(config: PusherConfig = {}) {
    this.config = config;
    // Defer fileOps creation until we have a valid sourceGuid
    // This allows validation to provide a helpful error message first
    if (state.sourceGuid && state.sourceGuid.length > 0 && state.sourceGuid[0]) {
      this.fileOps = new fileOperations(state.sourceGuid[0], null);
    }
  }

  /**
   * Execute all push operations for source to target GUID
   */
  async guidPusher(sourceGuid: string, targetGuid: string): Promise<PushResults> {
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
      publishablePageIds: [],
      publishableContentIdsByLocale: new Map(),
      publishablePageIdsByLocale: new Map(),
      failureDetails: [],
    };

    try {
      // Initialize GUID logger for this push operation
      initializeGuidLogger(sourceGuid, "push");

      // Execute all push operations for this GUID pair
      const pushResults = await this.executePushersInOrder(sourceGuid, targetGuid);

      // Consolidate results
      results.totalSuccess = pushResults.totalSuccess;
      results.totalFailures = pushResults.totalFailures;
      results.totalSkipped = pushResults.totalSkipped;
      results.publishableContentIds = pushResults.publishableContentIds;
      results.publishablePageIds = pushResults.publishablePageIds;
      results.publishableContentIdsByLocale = pushResults.publishableContentIdsByLocale;
      results.publishablePageIdsByLocale = pushResults.publishablePageIdsByLocale;
      results.failureDetails = pushResults.failureDetails;

      // Calculate final duration
      results.totalDuration = Date.now() - startTime;

      // Finalize the GUID logger (this creates the log file with source and target GUIDs)
      try {
        const logFilePath = finalizeGuidLogger(sourceGuid);
        if (logFilePath) {
          results.logFilePath = logFilePath;
        }
      } catch (logError: any) {
        console.error(`${sourceGuid}→${targetGuid}: Could not finalize log file - ${logError.message}`);
      }

      const duration = Math.floor(results.totalDuration / 1000);
      console.log(`${sourceGuid}→${targetGuid}: Completed in ${duration}s`);

      return results;
    } catch (error: any) {
      results.failed.push({ operation: "guid-orchestration", error: error.message });
      results.totalDuration = Date.now() - startTime;
      console.error(`${sourceGuid}→${targetGuid}: Failed - ${error.message}`);

      // Try to finalize log file even on error
      try {
        const logFilePath = finalizeGuidLogger(sourceGuid);
        if (logFilePath) {
          results.logFilePath = logFilePath;
        }
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
    const { sourceGuid: sourceGuids, targetGuid: targetGuids } = getState();

    if (sourceGuids.length === 0 || targetGuids.length === 0) {
      throw new Error("No source or target GUIDs available for push operation");
    }

    // For now, handle single source to single target (most common case)
    // Future enhancement: handle multiple source/target combinations
    const sourceGuid = sourceGuids[0];
    const targetGuid = targetGuids[0];

    console.log("--------------------------------");
    // console.log(`Starting push operations from ${sourceGuid} to ${targetGuid}`);
    // console.log(`Elements: ${elements}`);

    const result = await this.guidPusher(sourceGuid, targetGuid);

    return [result];
  }

  /**
   * Execute pushers in dependency order - moved from sync.ts
   */
  private async executePushersInOrder(
    sourceGuid: string,
    targetGuid: string,
  ): Promise<{
    totalSuccess: number;
    totalFailures: number;
    totalSkipped: number;
    publishableContentIds: number[];
    publishablePageIds: number[];
    publishableContentIdsByLocale: Map<string, number[]>;
    publishablePageIdsByLocale: Map<string, number[]>;
    failureDetails: FailureDetail[];
  }> {
    const { locale: locales, elements: stateElements } = state;
    const elements = stateElements.split(",");

    // Initialize results tracking
    let totalSuccess = 0;
    let totalFailures = 0;
    let totalSkipped = 0;
    const publishableContentIds: number[] = [];
    const publishablePageIds: number[] = [];
    // Per-locale tracking for proper batch workflow locale handling
    const publishableContentIdsByLocale = new Map<string, number[]>();
    const publishablePageIdsByLocale = new Map<string, number[]>();
    // Collect individual failure details
    const failureDetails: FailureDetail[] = [];

    // DEPENDENCY-OPTIMIZED ORDER: Galleries → Assets → Models → Containers → Content → Templates → Pages
    const pusherConfig = [
      PUSH_OPERATIONS.galleries,
      PUSH_OPERATIONS.assets,
      PUSH_OPERATIONS.models,
      PUSH_OPERATIONS.containers,
      PUSH_OPERATIONS.content,
      PUSH_OPERATIONS.templates,
      PUSH_OPERATIONS.pages,
    ];

    // Prepare model filtering options from state
    let filterOptions: ModelFilterOptions = {};
    if (state.models && state.models.trim().length > 0) {
      filterOptions.models = state.models.split(",").map((m) => m.trim());
    }
    if (state.modelsWithDeps && state.modelsWithDeps.trim().length > 0) {
      filterOptions.modelsWithDeps = state.modelsWithDeps.split(",").map((m) => m.trim());
    }

    // Reset logging flags for new operation
    const { GuidDataLoader } = await import('./guid-data-loader');
    const { ModelDependencyTreeBuilder } = await import('../models/model-dependency-tree-builder');
    GuidDataLoader.resetLoggingFlags();
    ModelDependencyTreeBuilder.resetLoggingFlags();

    // Load source and target data
    const sourceDataLoader = new GuidDataLoader(sourceGuid);
    const targetDataLoader = new GuidDataLoader(targetGuid);

    // Do guid level ops first 
    // TODO: use locale[0] as a temp locale THIS NEEDS TO BE REFACTORED
    try {
      const sourceData = await sourceDataLoader.loadGuidEntities(
        locales[0],
        Object.keys(filterOptions).length > 0 ? filterOptions : undefined,
      );
      const targetData = await targetDataLoader.loadGuidEntities(locales[0]);

      for (const config of pusherConfig) {
        if (config === PUSH_OPERATIONS.pages || config === PUSH_OPERATIONS.content) continue;
        // Execute guid level op
        const result = await this.executePushOperation({
          config,
          sourceData,
          targetData,
          locale: locales[0],
          publishableContentIds,
          publishablePageIds,
          elements,
        });
        // Accumulate results from returned values
        totalSuccess += result.success;
        totalFailures += result.failures;
        totalSkipped += result.skipped;
        if (result.failureDetails) {
          failureDetails.push(...result.failureDetails);
        }
      }
    } catch (error: any) {
      // Re-throw validation errors immediately to stop sync
      if (error?.message?.includes('Model validation failed')) {
        throw error;
      }
      // For other errors, log but don't stop (legacy behavior for guid-level ops)
      console.error(ansiColors.yellow(`Warning during guid-level operations: ${error?.message || error}`));
    }

    // Do the locale level ops
    try {
      for (const config of pusherConfig) {
        if (config !== PUSH_OPERATIONS.pages && config !== PUSH_OPERATIONS.content) continue;

        for (const locale of locales) {
          const sourceData = await sourceDataLoader.loadGuidEntities(
            locale,
            Object.keys(filterOptions).length > 0 ? filterOptions : undefined,
          );
          const targetData = await targetDataLoader.loadGuidEntities(locale);

          // Track IDs for this specific locale
          const localeContentIds: number[] = [];
          const localePageIds: number[] = [];

          const result = await this.executePushOperation({
            config,
            sourceData,
            targetData,
            locale,
            publishableContentIds: config === PUSH_OPERATIONS.content ? localeContentIds : publishableContentIds,
            publishablePageIds: config === PUSH_OPERATIONS.pages ? localePageIds : publishablePageIds,
            elements,
          });
          // Accumulate results from returned values
          totalSuccess += result.success;
          totalFailures += result.failures;
          totalSkipped += result.skipped;
          if (result.failureDetails) {
            failureDetails.push(...result.failureDetails);
          }

          // Store per-locale IDs and also add to combined list
          if (config === PUSH_OPERATIONS.content && localeContentIds.length > 0) {
            const existing = publishableContentIdsByLocale.get(locale) || [];
            publishableContentIdsByLocale.set(locale, [...existing, ...localeContentIds]);
            publishableContentIds.push(...localeContentIds);
          }
          if (config === PUSH_OPERATIONS.pages && localePageIds.length > 0) {
            const existing = publishablePageIdsByLocale.get(locale) || [];
            publishablePageIdsByLocale.set(locale, [...existing, ...localePageIds]);
            publishablePageIds.push(...localePageIds);
          }
        }
      }

      return {
        totalSuccess,
        totalFailures,
        totalSkipped,
        publishableContentIds,
        publishablePageIds,
        publishableContentIdsByLocale,
        publishablePageIdsByLocale,
        failureDetails,
      };
    } catch (error) {
      console.error(ansiColors.red("Error during pusher execution:"), error);
      throw error;
    }
  }

  async executePushOperation({
    config,
    sourceData,
    targetData,
    locale,
    publishableContentIds,
    publishablePageIds,
    elements,
  }: {
    config: PushOperationConfig;
    sourceData: GuidEntities;
    targetData: GuidEntities;
    locale: string;
    publishableContentIds?: number[];
    publishablePageIds?: number[];
    elements: string[];
  }): Promise<{ success: number; failures: number; skipped: number; failureDetails?: FailureDetail[] }> {
    const elementData = sourceData[config.dataKey as keyof GuidEntities] || [];

    // Skip if no data for this element type or element not requested
    if (
      (Array.isArray(elementData) && elementData.length === 0) ||
      !elements.some((element) => config.elements.includes(element))
    ) {
      console.log(ansiColors.yellow(`⚠️ Skipping ${config.description} for locale ${locale} - no data or filtered by --locales`));
      return { success: 0, failures: 0, skipped: 0, failureDetails: [] };
    }

    this.config.onOperationStart?.(config.name, state.sourceGuid[0], state.targetGuid[0]);

    const pusherResult: PusherResult = await config.handler(sourceData, targetData, locale);

    // Collect publishable IDs for workflow operations
    if (pusherResult.publishableIds && pusherResult.publishableIds.length > 0) {
      if (config.elements.includes("Content") && publishableContentIds) {
        publishableContentIds.push(...pusherResult.publishableIds);
      } else if (config.elements.includes("Pages") && publishablePageIds) {
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
        failedColor(`${pusherResult.failed} failed\n`),
    );

    this.config.onOperationComplete?.(
      config.name,
      state.sourceGuid[0],
      state.targetGuid[0],
      pusherResult.status === "success",
    );

    // Return the counts so they can be accumulated by the caller
    return {
      success: pusherResult.successful || 0,
      failures: pusherResult.failed || 0,
      skipped: pusherResult.skipped || 0,
      failureDetails: pusherResult.failureDetails || [],
    };
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
      duration: Date.now() - this.startTime.getTime(),
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
