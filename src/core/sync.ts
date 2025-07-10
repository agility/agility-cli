import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { fileOperations } from './fileOperations';
import { ReferenceMapper } from '../lib/shared/reference-mapper';
import { SourceDataLoader } from '../lib/shared/source-data-loader';
import { generateLogHeader } from '../lib/shared';
import { state } from './state';
import { PusherResult, SourceData } from '../types/sourceData';
import { ModelDependencyTree } from '../lib/models/model-dependency-tree-builder';
import { PublishService } from './publish';

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
    this.fileOps = new fileOperations(state.rootPath, state.sourceGuid[0], state.locale[0], state.preview);
    
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
    // Log sync header first, before setting up console logging to ensure it's the very first thing in the log
    const headerInfo = generateLogHeader('Sync', {
      'Source GUID': state.sourceGuid.join(', '),
      'Target GUID': state.targetGuid.join(', '),
      'Elements': state.elements,
      'Locale': state.locale.join(', '),
      'Channel': state.channel,
      'Preview Mode': state.preview
    });
    
    // Write header directly to log file before setting up console capture
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [INFO] ${headerInfo}\n`;
    this.fileOps.appendLogFile(logEntry);
    
    // Now set up console logging to capture all subsequent output
    this._setupConsoleLogging();
    
    let referenceMapper: ReferenceMapper | null = null;

    try {
      console.log(ansiColors.cyan(`\nStarting sync operation...`));
      console.log(ansiColors.gray(`Source: ${state.sourceGuid.join(', ')}`));
      console.log(ansiColors.gray(`Target: ${state.targetGuid.join(', ')}`));
      console.log(ansiColors.gray(`Elements: ${state.elements}`));

      // Load source data to check if we have any existing data
      console.log(ansiColors.cyan(`\nLoading source data...`));
      const sourceDataLoader = new SourceDataLoader();
      let sourceData = await sourceDataLoader.loadSourceEntities();

      // Check if we have any existing content
      let hasExistingContent = Object.values(sourceData).some((arr: any) => Array.isArray(arr) && arr.length > 0);

      // For sync operations, default to pulling fresh data unless explicitly disabled
      // Users can skip pulling by using --update=false to use cached data
      // This ensures we're syncing with current data by default
      const shouldPull = true;
      
      if (shouldPull) {
        if (!hasExistingContent) {
          console.log(ansiColors.cyan("🔄 No local source data found. Pulling from source instance..."));
        } else if (state.update) {
          console.log(ansiColors.cyan("🔄 Refreshing source data from source instance..."));
        }
        
        try {
          // Import and use Pull service directly with current state
          const { Pull } = await import('./pull');
          const pullOperation = new Pull();
          
          console.log(ansiColors.gray("Executing pull operation..."));
          
          // Temporarily restore console methods during pull operation
          this._restoreConsole();
          
          await pullOperation.pullInstance();
          
          // Re-setup console logging after pull completion
          this._setupConsoleLogging();
          
          // console.log(ansiColors.green("Source data pull completed"));
          
          // Reload source data after pull
          // console.log(ansiColors.cyan("📥 Reloading source data..."));
          sourceData = await sourceDataLoader.loadSourceEntities();
        } catch (pullError: any) {
          console.error(ansiColors.red(`❌ Failed to pull source data: ${pullError.message}`));
          console.log(ansiColors.gray("💡 Please try running pull manually first:"));
          console.log(ansiColors.gray(`   agility pull --sourceGuid ${state.sourceGuid.join(',')} --locale ${state.locale.join(',')} --channel ${state.channel} --verbose`));
          return;
        }
      } else {
        console.log(ansiColors.cyan("📋 Using existing local source data (--no-update specified)"));
      }

      // Final check if we have any content to sync
      let hasContent = Object.values(sourceData).some((arr: any) => Array.isArray(arr) && arr.length > 0);
      if (!hasContent) {
        console.log(ansiColors.red("❌ No source data available to sync"));
        console.log(ansiColors.gray("💡 This may indicate:"));
        console.log(ansiColors.gray("   - Source instance has no content"));
        console.log(ansiColors.gray("   - Authentication issues"));
        console.log(ansiColors.gray("   - Network connectivity problems"));
        console.log(ansiColors.gray("💡 Try running pull manually first:"));
        console.log(ansiColors.gray(`   agility pull --sourceGuid ${state.sourceGuid.join(',')} --elements ${state.elements} --verbose`));
        return;
      }

      // **NEW: Task 105 - Selective Model-Based Sync Integration**
      if (state.models && state.models.trim().length > 0) {
        const modelNames = state.models.split(',').map(name => name.trim());
        console.log(ansiColors.cyan(`Selective Model Sync: ${modelNames.join(', ')}`));
        
        // Import and use ModelDependencyTreeBuilder
        const { ModelDependencyTreeBuilder } = await import('../lib/models/model-dependency-tree-builder');
        const treeBuilder = new ModelDependencyTreeBuilder(sourceData);
        
        // Validate that specified models exist
        const validation = treeBuilder.validateModels(modelNames);
        if (validation.invalid.length > 0) {
          console.log(ansiColors.red(`❌ Invalid model names: ${validation.invalid.join(', ')}`));
          console.log(ansiColors.gray(`Available models: ${sourceData.models.map(m => m.referenceName).join(', ')}`));
          return;
        }
        
        // Build dependency tree
        const dependencyTree = treeBuilder.buildDependencyTree(validation.valid);
        
      
        
        // Filter source data to only include entities in dependency tree
        sourceData = this.filterSourceDataByDependencyTree(sourceData, dependencyTree);
        
        // Re-check if we have content after filtering
        hasContent = Object.values(sourceData).some((arr: any) => Array.isArray(arr) && arr.length > 0);
        if (!hasContent) {
          console.log(ansiColors.yellow("⚠️ No content found after model filtering"));
          return;
        }
        
        // console.log(ansiColors.green('✅ Source data filtered to model dependencies'));
      }

      // Set up reference mapper - gets config from state internally
      referenceMapper = new ReferenceMapper();

      // Declare syncResults for both single and multi-target paths
      let syncResults: {
        totalSuccess: number;
        totalFailures: number;
        totalSkipped: number;
        publishableContentIds: number[];
        publishablePageIds: number[];
      };

      // **NEW: Matrix Orchestration for Multi-Target Sync**
      if (state.targetGuid.length > 1) {
        console.log(ansiColors.cyan(`\n🎯 Multi-target sync detected: ${state.targetGuid.length} targets`));
        console.log(ansiColors.gray(`Using Matrix Orchestrator for coordinated sync...`));
        
        // Import and use PusherOrchestrator for multi-target operations
        const { PusherOrchestrator } = await import('../lib/pushers/orchestrate-pushers');
        
        const orchestrator = new PusherOrchestrator({
          sourceData,
          elements: state.elements.split(","),
          onTargetStart: (sourceGuid, targetGuid, locale) => {
            console.log(ansiColors.blue(`🚀 Starting sync: ${sourceGuid} → ${targetGuid} (${locale})`));
          },
          onTargetComplete: (sourceGuid, targetGuid, locale, success) => {
            const statusColor = success ? ansiColors.green : ansiColors.red;
            const statusIcon = success ? '✅' : '❌';
            console.log(statusColor(`${statusIcon} Completed: ${sourceGuid} → ${targetGuid} (${locale})`));
          },
          onProgress: (current, total) => {
            console.log(ansiColors.gray(`📊 Progress: ${current}/${total} operations`));
          }
        });
        
        // Execute matrix orchestration
        const orchestrationResults = await orchestrator.orchestrateMatrix();
        
        // Convert orchestration results to sync results format
        syncResults = {
          totalSuccess: orchestrationResults.overallSuccess,
          totalFailures: orchestrationResults.overallFailures,
          totalSkipped: orchestrationResults.overallSkipped,
          publishableContentIds: orchestrationResults.targetResults.flatMap(r => r.publishableContentIds),
          publishablePageIds: orchestrationResults.targetResults.flatMap(r => r.publishablePageIds)
        };
        
      } else {
        // **EXISTING: Single-target sync logic (preserved exactly)**
        const targetGuid = state.targetGuid[0];
        console.log(ansiColors.cyan(`\n🎯 Single-target sync: ${targetGuid}`));
        
        // Auto-discover locales for target instance like pull operation does
        const targetLocales = state.guidLocaleMap.get(targetGuid) || state.locale || ['en-us'];
        console.log(ansiColors.gray(`Target locales: ${targetLocales.join(', ')}`));
        
        // Execute sync operation and capture results
        syncResults = await this.executePushersInOrder(sourceData, referenceMapper, state.elements.split(","));
      }

      // Execute auto-publishing if --publish flag is set (works for both single and multi-target)
      if (state.publish && (syncResults.publishableContentIds.length > 0 || syncResults.publishablePageIds.length > 0)) {
        
        try {
          // Import and use PublishService
                      const { PublishService } = await import('./publish');
            const publishService = new PublishService({
              verbose: true
            });

          const publishResults = await publishService.publishAll(
            syncResults.publishableContentIds,
            syncResults.publishablePageIds
          );

          // Report publishing results
          const totalPublished = publishResults.contentItems.successful.length + publishResults.pages.successful.length;
          const totalPublishFailed = publishResults.contentItems.failed.length + publishResults.pages.failed.length;

          if (totalPublishFailed === 0) {
            console.log('\n')
            // console.log(ansiColors.green(`✅ Auto-publishing completed successfully: ${totalPublished} items published`));
          } else {
            console.log(ansiColors.yellow(`⚠️ Auto-publishing completed with ${totalPublishFailed} failures: ${totalPublished} items published`));
            console.log(ansiColors.gray(`💡 Publishing failures do not affect sync success - items are synced but not published`));
          }
        } catch (publishError: any) {
          console.log(ansiColors.yellow(`⚠️ Auto-publishing failed: ${publishError.message}`));
          console.log(ansiColors.gray(`💡 Sync operation completed successfully - only publishing step failed`));
        }
      } else if (state.publish) {
        console.log(ansiColors.gray(`📝 Auto-publishing enabled but no publishable items found`));
      }

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
              ((syncResults.totalSuccess + syncResults.totalSkipped + syncResults.totalFailures) / totalSourceEntities) * 100
            )
          : 100;

      // Enhanced reporting using sync results
      const successColor = syncResults.totalSuccess > 0 ? ansiColors.green : ansiColors.gray;
      const skippedColor = syncResults.totalSkipped > 0 ? ansiColors.yellow : ansiColors.gray;
      const failedColor = syncResults.totalFailures > 0 ? ansiColors.red : ansiColors.gray;
      const reconciliationColor = reconciliationPercentage === 100 ? ansiColors.bold.green : ansiColors.bold.red;

      console.log(
        ansiColors.gray(`Total Source Entities: ${ansiColors.white(totalSourceEntities.toString())}\n`) +
          successColor(`${syncResults.totalSuccess} successful, `) +
          skippedColor(`${syncResults.totalSkipped} skipped, `) +
          failedColor(`${syncResults.totalFailures} failed, `) +
          ansiColors.gray(`Reconciliation: ${reconciliationColor(reconciliationPercentage.toString() + "%")}`)
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
        this.originalConsoleLog(`\nSync log file written to: ${finalizedLogPath}\n`);
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
    publishableContentIds: number[];
    publishablePageIds: number[];
  }> {
    // Import all pushers for embedded configuration
    const { pushModels, pushGalleries, pushAssets, pushContainers, pushContent, pushTemplates, pushPages } = await import('../lib/pushers');
    
    // Import batch processor for batch processing option
    const { ContentBatchProcessor } = await import('../lib/pushers/content-item-batch-pusher');

    // Initialize results tracking
    let totalSuccess = 0;
    let totalFailures = 0;
    let totalSkipped = 0;
    const publishableContentIds: number[] = [];
    const publishablePageIds: number[] = [];

    // Create wrapper function for content processing that chooses between individual vs batch pushers
    const smartContentPusher = async (sourceData: any, referenceMapper: ReferenceMapper) => {
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
        const { areContentDependenciesResolved } = await import('../lib/pushers/content-item-pusher');
        
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
        let totalSkipped = 0; // Add tracking for skipped items
        const allPublishableIds: number[] = [];
        
        try {
          // Import getApiClient for both batch configurations
          const { getApiClient } = await import('../core/state');
          
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
            totalSkipped += normalResult.skippedCount; // Capture skipped count
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
            totalSkipped += linkedResult.skippedCount; // Capture skipped count
            allPublishableIds.push(...linkedResult.publishableIds);
          }
          
          // Convert batch result to expected PusherResult format
          return {
            status: (totalFailed > 0 ? 'error' : 'success') as 'success' | 'error',
            successful: totalSuccessful,
            failed: totalFailed,
            skipped: totalSkipped, // Use actual skipped count from batch processors
            publishableIds: allPublishableIds
          };
        } catch (batchError: any) {
          console.error(ansiColors.red(`❌ Batch processing failed: ${batchError.message}`));
          console.log(ansiColors.yellow(`🔄 Falling back to individual processing...`));
          return await pushContent(sourceData, referenceMapper);
        }
      }
    };

    // DEPENDENCY-OPTIMIZED ORDER: Galleries → Assets → Models → Containers → Content → Templates → Pages
    // This ensures proper dependency resolution with galleries first, then assets, then models that reference them
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

        
        // Pass FULL sourceData to pusher so it can access whatever it needs (models, assets, etc.)
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
          ansiColors.gray(`\n${config.name}: `) +
          successfulColor(`${pusherResult.successful} successful, `) +
          skippedColor(`${pusherResult.skipped} skipped, `) +
          failedColor(`${pusherResult.failed} failed\n`)
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
   * Filter source data to only include entities in the dependency tree
   * Task 105: Sync Integration - Filter source data by model dependencies
   */
  private filterSourceDataByDependencyTree(
    sourceData: SourceData, 
    dependencyTree: ModelDependencyTree
  ): SourceData {
    
    return {
      models: sourceData.models.filter(m => dependencyTree.models.has(m.referenceName)),
      containers: sourceData.containers.filter(c => dependencyTree.containers.has(c.contentViewID)),
      content: sourceData.content.filter(c => dependencyTree.content.has(c.contentID)),
      templates: sourceData.templates.filter(t => dependencyTree.templates.has(t.pageTemplateID)),
      pages: sourceData.pages.filter(p => dependencyTree.pages.has(p.pageID)),
      assets: sourceData.assets.filter((a: any) => {
        // Check all possible asset URL properties
        return dependencyTree.assets.has(a.originUrl) || 
               dependencyTree.assets.has(a.url) || 
               dependencyTree.assets.has(a.edgeUrl);
      }),
      galleries: sourceData.galleries.filter(g => dependencyTree.galleries.has(g.mediaGroupingID))
    };
  }

} 