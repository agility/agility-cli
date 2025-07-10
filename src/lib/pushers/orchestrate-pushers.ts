/**
 * Pusher Orchestrator - Matrix coordination for multi-target sync operations
 * 
 * Wraps the existing executePushersInOrder logic with matrix coordination
 * to support syncing from single source to multiple targets with locale validation.
 */

import ansiColors from 'ansi-colors';
import { ReferenceMapper } from '../shared/reference-mapper';
import { SourceData, PusherResult } from '../../types/sourceData';
import { state } from '../../core/state';

export interface PusherOrchestrationResult {
  sourceGuid: string;
  targetResults: Array<{
    targetGuid: string;
    locale: string;
    totalSuccess: number;
    totalFailures: number;
    totalSkipped: number;
    publishableContentIds: number[];
    publishablePageIds: number[];
    executionTime: number;
    status: 'success' | 'partial' | 'failed';
    errorDetails?: {
      phase: string;
      error: string;
      recoverable: boolean;
    };
  }>;
  overallSuccess: number;
  overallFailures: number;
  overallSkipped: number;
  totalExecutionTime: number;
  successfulTargets: number;
  failedTargets: number;
  partialTargets: number;
}

export interface PusherOrchestrationConfig {
  sourceData: SourceData;
  elements: string[];
  onTargetStart?: (sourceGuid: string, targetGuid: string, locale: string) => void;
  onTargetComplete?: (sourceGuid: string, targetGuid: string, locale: string, success: boolean, result?: any) => void;
  onTargetError?: (sourceGuid: string, targetGuid: string, locale: string, error: Error, phase: string) => void;
  onProgress?: (current: number, total: number) => void;
  onPhaseProgress?: (targetGuid: string, phase: string, current: number, total: number) => void;
  continueOnError?: boolean;  // Whether to continue with other targets if one fails
  maxRetries?: number;        // Maximum retries per target
  retryDelay?: number;        // Delay between retries in milliseconds
}

export class PusherOrchestrator {
  private config: PusherOrchestrationConfig;
  
  constructor(config: PusherOrchestrationConfig) {
    this.config = {
      ...config,
      // Use state values as defaults if not explicitly provided
      continueOnError: config.continueOnError ?? state.continueOnError,
      maxRetries: config.maxRetries ?? state.maxRetries,
      retryDelay: config.retryDelay ?? state.retryDelay
    };
    
    // Validate configuration
    if (!this.config.sourceData) {
      throw new Error('PusherOrchestrator requires sourceData');
    }
    
    if (!this.config.elements || this.config.elements.length === 0) {
      throw new Error('PusherOrchestrator requires elements array');
    }
    
    console.log(ansiColors.gray(`🔧 PusherOrchestrator initialized with ${this.config.elements.length} elements`));
  }

  /**
   * Orchestrate matrix sync across multiple targets with enhanced error handling and progress tracking
   */
  async orchestrateMatrix(): Promise<PusherOrchestrationResult> {
    const sourceGuid = state.sourceGuid[0];
    const targetGuids = state.targetGuid;
    
    // Auto-discover locales like pull operation does
    // Use guidLocaleMap to get target-specific locales for each target GUID
    const allLocales = new Set<string>();
    for (const targetGuid of targetGuids) {
      const guidLocales = state.guidLocaleMap.get(targetGuid) || ['en-us'];
      guidLocales.forEach(locale => allLocales.add(locale));
    }
    const locales = Array.from(allLocales);
    const startTime = Date.now();
    
    console.log(ansiColors.cyan(`\n🎯 Matrix Orchestrator Starting`));
    console.log(ansiColors.gray(`Source: ${sourceGuid}`));
    console.log(ansiColors.gray(`Targets: ${targetGuids.join(', ')}`));
    console.log(ansiColors.gray(`Locales: ${locales.join(', ')}`));
    console.log(ansiColors.gray(`Elements: ${this.config.elements.join(', ')}`));
    
    const targetResults: PusherOrchestrationResult['targetResults'] = [];
    const totalOperations = targetGuids.length * locales.length;
    let currentOperation = 0;
    
    const continueOnError = this.config.continueOnError ?? true;
    const maxRetries = this.config.maxRetries ?? 2;
    const retryDelay = this.config.retryDelay ?? 1000;
    
    console.log(ansiColors.gray(`Configuration: continueOnError=${continueOnError}, maxRetries=${maxRetries}, retryDelay=${retryDelay}ms`));
    
    // Process each target×locale combination
    for (const targetGuid of targetGuids) {
      for (const locale of locales) {
        currentOperation++;
        const operationStartTime = Date.now();
        
        // Call onTargetStart callback
        if (this.config.onTargetStart) {
          this.config.onTargetStart(sourceGuid, targetGuid, locale);
        }
        
        // Call onProgress callback
        if (this.config.onProgress) {
          this.config.onProgress(currentOperation, totalOperations);
        }
        
        let attempts = 0;
        let lastError: Error | null = null;
        let targetResult: PusherOrchestrationResult['targetResults'][0] | null = null;
        
        // Retry loop for each target
        while (attempts <= maxRetries && !targetResult) {
          attempts++;
          
          try {
            if (attempts > 1) {
              console.log(ansiColors.yellow(`🔄 Retry attempt ${attempts}/${maxRetries + 1} for ${targetGuid} (${locale})`));
              
              // Wait before retry
              if (retryDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
              }
            }
            
            // Validate locale compatibility
            const isLocaleCompatible = await this.validateLocaleCompatibility(sourceGuid, targetGuid, locale);
            
            if (!isLocaleCompatible) {
              const error = new Error(`Locale '${locale}' is not compatible between source and target instances`);
              
              if (this.config.onTargetError) {
                this.config.onTargetError(sourceGuid, targetGuid, locale, error, 'locale_validation');
              }
              
              targetResult = {
                targetGuid,
                locale,
                totalSuccess: 0,
                totalFailures: 0,
                totalSkipped: 0,
                publishableContentIds: [],
                publishablePageIds: [],
                executionTime: Date.now() - operationStartTime,
                status: 'failed',
                errorDetails: {
                  phase: 'locale_validation',
                  error: error.message,
                  recoverable: false
                }
              };
              
              break; // Don't retry for locale compatibility issues
            }
            
            // Create temporary state for this target×locale combination
            const originalState = { ...state };
            
            // Update state for this specific target×locale
            state.targetGuid = [targetGuid];
            state.locale = [locale];
            
            // Execute pushers for this target×locale
            const result = await this.executePushersWithProgress(
              this.config.sourceData,
              targetGuid,
              locale,
              this.config.elements
            );
            
            // Restore original state
            Object.assign(state, originalState);
            
            // Determine status based on results
            let status: 'success' | 'partial' | 'failed' = 'success';
            if (result.totalFailures > 0) {
              status = result.totalSuccess > 0 ? 'partial' : 'failed';
            }
            
            targetResult = {
              targetGuid,
              locale,
              totalSuccess: result.totalSuccess,
              totalFailures: result.totalFailures,
              totalSkipped: result.totalSkipped,
              publishableContentIds: result.publishableContentIds,
              publishablePageIds: result.publishablePageIds,
              executionTime: Date.now() - operationStartTime,
              status
            };
            
            // Call onTargetComplete callback
            if (this.config.onTargetComplete) {
              this.config.onTargetComplete(sourceGuid, targetGuid, locale, status === 'success', targetResult);
            }
            
            break; // Success, exit retry loop
            
          } catch (error: any) {
            lastError = error;
            
            const isLastAttempt = attempts > maxRetries;
            const phase = this.determineErrorPhase(error);
            const isRecoverable = this.isRecoverableError(error);
            
            console.log(ansiColors.red(`❌ Error in ${phase} for ${targetGuid} (${locale}): ${error.message}`));
            
            if (this.config.onTargetError) {
              this.config.onTargetError(sourceGuid, targetGuid, locale, error, phase);
            }
            
            if (isLastAttempt || !isRecoverable) {
              // Final failure - create failed result
              targetResult = {
                targetGuid,
                locale,
                totalSuccess: 0,
                totalFailures: 0,
                totalSkipped: 0,
                publishableContentIds: [],
                publishablePageIds: [],
                executionTime: Date.now() - operationStartTime,
                status: 'failed',
                errorDetails: {
                  phase,
                  error: error.message,
                  recoverable: isRecoverable
                }
              };
              
              if (this.config.onTargetComplete) {
                this.config.onTargetComplete(sourceGuid, targetGuid, locale, false, targetResult);
              }
              
              // Check if we should continue with other targets
              if (!continueOnError) {
                console.log(ansiColors.red(`🛑 Stopping matrix orchestration due to error (continueOnError=false)`));
                throw error;
              }
              
              break; // Exit retry loop
            }
            
            console.log(ansiColors.yellow(`⏳ Retrying in ${retryDelay}ms (attempt ${attempts}/${maxRetries + 1})`));
          }
        }
        
        if (targetResult) {
          targetResults.push(targetResult);
          
          // Log result summary
          const statusIcon = targetResult.status === 'success' ? '✅' : 
                            targetResult.status === 'partial' ? '⚠️' : '❌';
          const statusColor = targetResult.status === 'success' ? ansiColors.green : 
                             targetResult.status === 'partial' ? ansiColors.yellow : ansiColors.red;
          
          console.log(statusColor(`${statusIcon} ${targetGuid} (${locale}): ${targetResult.totalSuccess} successful, ${targetResult.totalFailures} failed, ${targetResult.totalSkipped} skipped`));
        }
      }
    }
    
    // Calculate overall results
    const overallSuccess = targetResults.reduce((sum, r) => sum + r.totalSuccess, 0);
    const overallFailures = targetResults.reduce((sum, r) => sum + r.totalFailures, 0);
    const overallSkipped = targetResults.reduce((sum, r) => sum + r.totalSkipped, 0);
    const totalExecutionTime = Date.now() - startTime;
    
    const result: PusherOrchestrationResult = {
      sourceGuid,
      targetResults,
      overallSuccess,
      overallFailures,
      overallSkipped,
      totalExecutionTime,
      successfulTargets: targetResults.filter(r => r.status === 'success').length,
      failedTargets: targetResults.filter(r => r.status === 'failed').length,
      partialTargets: targetResults.filter(r => r.status === 'partial').length
    };
    
    // Final summary
    console.log(ansiColors.cyan(`\n🎯 Matrix Orchestration Summary`));
    console.log(ansiColors.gray(`Total execution time: ${(totalExecutionTime / 1000).toFixed(2)}s`));
    console.log(ansiColors.green(`✅ Successful targets: ${result.successfulTargets}`));
    console.log(ansiColors.yellow(`⚠️ Partial targets: ${result.partialTargets}`));
    console.log(ansiColors.red(`❌ Failed targets: ${result.failedTargets}`));
    console.log(ansiColors.gray(`Overall: ${overallSuccess} successful, ${overallFailures} failed, ${overallSkipped} skipped`));
    
    return result;
  }

  /**
   * Validate locale compatibility between source and targets
   */
  private async validateLocaleCompatibility(sourceGuid: string, targetGuid: string, locale: string): Promise<boolean> {
    const sourceLocales = state.guidLocaleMap.get(sourceGuid) || [];
    const targetLocales = state.guidLocaleMap.get(targetGuid) || [];
    
    if (sourceLocales.length === 0) {
      console.log(ansiColors.yellow(`⚠️ No locales found for source GUID: ${sourceGuid}, skipping`));
      return false;
    }
    
    if (targetLocales.length === 0) {
      console.log(ansiColors.yellow(`⚠️ No locales found for target GUID: ${targetGuid}, skipping`));
      return false;
    }
    
    // Find intersection of locales
    const compatibleLocales = sourceLocales.filter(l => targetLocales.includes(l));
    
    if (compatibleLocales.length === 0) {
      console.log(ansiColors.yellow(`⚠️ No compatible locales between source ${sourceGuid} and target ${targetGuid} for locale '${locale}', skipping`));
      return false;
    }
    
    console.log(ansiColors.gray(`✓ ${targetGuid}: Compatible locales [${compatibleLocales.join(', ')}]`));
    return true;
  }

  /**
   * Execute pushers in dependency order (copied from sync.ts)
   * This preserves the existing logic exactly
   */
  private async executePushersInOrder(
    sourceData: SourceData,
    referenceMapper: ReferenceMapper,
    elements: string[]
  ): Promise<{
    totalSuccess: number;
    totalFailures: number;
    totalSkipped: number;
    publishableContentIds: number[];
    publishablePageIds: number[];
  }> {
    // Import all pushers for embedded configuration
    const { pushModels, pushGalleries, pushAssets, pushContainers, pushContent, pushTemplates, pushPages } = await import('./index');
    
    // Import batch processor for batch processing option
    const { ContentBatchProcessor } = await import('./content-item-batch-pusher');

    // Initialize results tracking
    let totalSuccess = 0;
    let totalFailures = 0;
    let totalSkipped = 0;
    const publishableContentIds: number[] = [];
    const publishablePageIds: number[] = [];

    // Create wrapper function for content processing (copied from sync.ts)
    const smartContentPusher = async (sourceData: SourceData, referenceMapper: ReferenceMapper) => {
      if (state.noBatch) {
        // Use individual pusher when --no-batch flag is enabled
        return await pushContent(sourceData, referenceMapper);
      } else {
        // Use batch pusher for better performance (default behavior)
        
        const contentItems = sourceData.content || [];
        
        if (contentItems.length === 0) {
          return { status: 'success' as const, successful: 0, failed: 0, skipped: 0, publishableIds: [] };
        }
        
        // Import dependency checking functions
        const { areContentDependenciesResolved } = await import('./content-item-pusher');
        
        // Separate content items into normal and linked batches
        const normalContentItems: any[] = [];
        const linkedContentItems: any[] = [];
        
        for (const contentItem of contentItems) {
          // Find source model for this content item
          let sourceModel = sourceData.models?.find((m: any) => m.referenceName === contentItem.properties.definitionName);
          if (!sourceModel && sourceData.models) {
            sourceModel = sourceData.models.find((m: any) => 
              m.referenceName.toLowerCase() === contentItem.properties.definitionName.toLowerCase()
            );
          }
          
          if (!sourceModel) {
            // No model found - treat as linked content for dependency resolution
            linkedContentItems.push(contentItem);
            continue;
          }
          
          // Check if content has unresolved dependencies
          if (areContentDependenciesResolved(contentItem, referenceMapper, [sourceModel])) {
            normalContentItems.push(contentItem);
          } else {
            linkedContentItems.push(contentItem);
          }
        }
        
        let totalSuccessful = 0;
        let totalFailed = 0;
        let totalSkipped = 0;
        const allPublishableIds: number[] = [];
        
        try {
          // Import getApiClient for both batch configurations
          const { getApiClient } = await import('../../core/state');
          
          // Process normal content items first (no dependencies)
          if (normalContentItems.length > 0) {
            const normalBatchConfig = {
              apiClient: getApiClient(),
              targetGuid: state.targetGuid[0],
              locale: state.locale[0],
              referenceMapper,
              batchSize: 250,
              useContentFieldMapper: true,
              models: sourceData.models,
              defaultAssetUrl: '',
            };
            
            const normalBatchProcessor = new ContentBatchProcessor(normalBatchConfig);
            const normalResult = await normalBatchProcessor.processBatches(normalContentItems, undefined, 'Normal Content');
            
            totalSuccessful += normalResult.successCount;
            totalFailed += normalResult.failureCount;
            totalSkipped += normalResult.skippedCount;
            allPublishableIds.push(...normalResult.publishableIds);
          }
          
          // Process linked content items second (with dependencies)
          if (linkedContentItems.length > 0) {
            const linkedBatchConfig = {
              apiClient: getApiClient(),
              targetGuid: state.targetGuid[0],
              locale: state.locale[0],
              referenceMapper,
              batchSize: 100, // Smaller batches for linked content due to complexity
              useContentFieldMapper: true,
              models: sourceData.models,
              defaultAssetUrl: '',
            };
            
            const linkedBatchProcessor = new ContentBatchProcessor(linkedBatchConfig);
            const linkedResult = await linkedBatchProcessor.processBatches(linkedContentItems, undefined, 'Linked Content');
            
            totalSuccessful += linkedResult.successCount;
            totalFailed += linkedResult.failureCount;
            totalSkipped += linkedResult.skippedCount;
            allPublishableIds.push(...linkedResult.publishableIds);
          }
          
          // Convert batch result to expected PusherResult format
          return {
            status: (totalFailed > 0 ? 'error' : 'success') as 'success' | 'error',
            successful: totalSuccessful,
            failed: totalFailed,
            skipped: totalSkipped,
            publishableIds: allPublishableIds
          };
        } catch (batchError: any) {
          console.error(ansiColors.red(`❌ Batch processing failed: ${batchError.message}`));
          console.log(ansiColors.yellow(`🔄 Falling back to individual processing...`));
          return await pushContent(sourceData, referenceMapper);
        }
      }
    };

    // DEPENDENCY-OPTIMIZED ORDER (copied from sync.ts)
    const pusherConfig = [
      { element: 'Galleries', dataKey: 'galleries', name: 'Galleries', pusher: pushGalleries },
      { element: 'Assets', dataKey: 'assets', name: 'Assets', pusher: pushAssets },
      { element: 'Models', dataKey: 'models', name: 'Models', pusher: pushModels },
      { element: 'Containers', dataKey: 'containers', name: 'Containers', pusher: pushContainers },
      { element: 'Content', dataKey: 'content', name: 'Content Items', pusher: smartContentPusher },
      { element: 'Templates', dataKey: 'templates', name: 'Templates', pusher: pushTemplates },
      { element: 'Pages', dataKey: 'pages', name: 'Pages', pusher: pushPages }
    ];

    try {
      for (const config of pusherConfig) {
        // Get the specific data array for this element type
        const elementData = sourceData[config.dataKey] || [];
        
        // Skip if no data for this element type or element not requested
        if (elementData.length === 0 || !elements.includes(config.element)) {
          continue;
        }

        // Pass FULL sourceData to pusher so it can access whatever it needs
        const pusherResult: PusherResult = await config.pusher(sourceData, referenceMapper);

        // Accumulate results using standardized pattern
        totalSuccess += pusherResult.successful || 0;
        totalSkipped += pusherResult.skipped || 0;
        totalFailures += pusherResult.failed || 0;

        // Collect publishable IDs for auto-publishing
        if (pusherResult.publishableIds && pusherResult.publishableIds.length > 0) {
          if (config.element === 'Content') {
            publishableContentIds.push(...pusherResult.publishableIds);
          } else if (config.element === 'Pages') {
            publishablePageIds.push(...pusherResult.publishableIds);
          }
        }

        // Report individual pusher results
        const successfulColor = pusherResult.successful > 0 ? ansiColors.green : ansiColors.gray;
        const failedColor = pusherResult.failed > 0 ? ansiColors.red : ansiColors.gray;
        const skippedColor = pusherResult.skipped > 0 ? ansiColors.yellow : ansiColors.gray;
        console.log(
          ansiColors.gray(`${config.name}: `) +
          successfulColor(`${pusherResult.successful} successful, `) +
          skippedColor(`${pusherResult.skipped} skipped, `) +
          failedColor(`${pusherResult.failed} failed`)
        );

        // Save mappings after each pusher
        await referenceMapper.saveAllMappings();
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
   * Execute pushers with enhanced progress tracking for a specific target
   */
  private async executePushersWithProgress(
    sourceData: SourceData,
    targetGuid: string,
    locale: string,
    elements: string[]
  ): Promise<{
    totalSuccess: number;
    totalFailures: number;
    totalSkipped: number;
    publishableContentIds: number[];
    publishablePageIds: number[];
  }> {
    
    // Create reference mapper for this target×locale combination
    const referenceMapper = new ReferenceMapper();
    
    // Call onPhaseProgress callback for start
    if (this.config.onPhaseProgress) {
      this.config.onPhaseProgress(targetGuid, 'initialization', 0, 1);
    }
    
    // Execute the existing pushers logic (copied from sync.ts)
    const result = await this.executePushersInOrder(sourceData, referenceMapper, elements);
    
    // Call onPhaseProgress callback for completion
    if (this.config.onPhaseProgress) {
      this.config.onPhaseProgress(targetGuid, 'completion', 1, 1);
    }
    
    return result;
  }
  
  /**
   * Determine the phase where an error occurred
   */
  private determineErrorPhase(error: Error): string {
    const message = error.message.toLowerCase();
    
    if (message.includes('locale') || message.includes('compatible')) {
      return 'locale_validation';
    }
    if (message.includes('auth') || message.includes('token') || message.includes('unauthorized')) {
      return 'authentication';
    }
    if (message.includes('network') || message.includes('connect') || message.includes('timeout')) {
      return 'network';
    }
    if (message.includes('model') || message.includes('container') || message.includes('template')) {
      return 'dependency_resolution';
    }
    if (message.includes('content') || message.includes('page')) {
      return 'content_processing';
    }
    if (message.includes('asset') || message.includes('gallery')) {
      return 'media_processing';
    }
    if (message.includes('mapping') || message.includes('reference')) {
      return 'reference_mapping';
    }
    
    return 'unknown';
  }
  
  /**
   * Determine if an error is recoverable (worth retrying)
   */
  private isRecoverableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Non-recoverable errors
    if (message.includes('locale') && message.includes('compatible')) return false;
    if (message.includes('unauthorized') || message.includes('forbidden')) return false;
    if (message.includes('not found') && message.includes('model')) return false;
    if (message.includes('invalid') && message.includes('guid')) return false;
    
    // Recoverable errors (network, timeouts, temporary server issues)
    if (message.includes('timeout')) return true;
    if (message.includes('network')) return true;
    if (message.includes('connect')) return true;
    if (message.includes('server error')) return true;
    if (message.includes('503') || message.includes('502') || message.includes('500')) return true;
    
    // Default to non-recoverable for safety
    return false;
  }
} 