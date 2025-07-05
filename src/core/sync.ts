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
    this.fileOps = new fileOperations(state.rootPath, state.sourceGuid, state.locale, state.preview);
    
    // Store original console methods for restoration
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
  }

  /**
   * Log sync operation header with version info
   */
  private logSyncHeader(): void {
    
    const headerInfo = generateLogHeader('Sync', {
      'Source GUID': state.sourceGuid,
      'Target GUID': state.targetGuid,
      'Elements': state.elements,
      'Locale': state.locale,
      'Channel': state.channel,
      'Preview Mode': state.preview
    });

    this._logToFile(headerInfo);
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
    this._setupConsoleLogging();
    
    // Log sync header with version info immediately after setting up logging
    this.logSyncHeader();
    
    let referenceMapper: ReferenceMapper | null = null;

    try {
      console.log(ansiColors.cyan(`\n🔄 Starting sync operation...`));
      console.log(ansiColors.gray(`Source: ${state.sourceGuid}`));
      console.log(ansiColors.gray(`Target: ${state.targetGuid}`));
      console.log(ansiColors.gray(`Elements: ${state.elements}`));

      // Load source data to check if we have any existing data
      console.log(ansiColors.cyan(`\n📥 Loading source data...`));
      const sourceDataLoader = new SourceDataLoader();
      let sourceData = await sourceDataLoader.loadSourceEntities();

      // Check if we have any existing content
      let hasExistingContent = Object.values(sourceData).some((arr: any) => Array.isArray(arr) && arr.length > 0);

      // Determine if we should pull fresh data
      const shouldPull = state.update || !hasExistingContent;
      
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
          
          console.log(ansiColors.green("✅ Source data pull completed"));
          
          // Reload source data after pull
          console.log(ansiColors.cyan("📥 Reloading source data..."));
          sourceData = await sourceDataLoader.loadSourceEntities();
        } catch (pullError: any) {
          console.error(ansiColors.red(`❌ Failed to pull source data: ${pullError.message}`));
          console.log(ansiColors.gray("💡 Please try running pull manually first:"));
          console.log(ansiColors.gray(`   agility pull --sourceGuid ${state.sourceGuid} --locale ${state.locale} --channel ${state.channel} --verbose`));
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
        console.log(ansiColors.gray(`   agility pull --sourceGuid ${state.sourceGuid} --elements ${state.elements} --verbose`));
        return;
      }

      // **NEW: Task 105 - Selective Model-Based Sync Integration**
      if (state.models && state.models.trim().length > 0) {
        const modelNames = state.models.split(',').map(name => name.trim());
        console.log(ansiColors.cyan(`🎯 Selective Model Sync: ${modelNames.join(', ')}`));
        
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
        
        // Show analysis
        console.log(ansiColors.cyan('📊 Dependency Analysis:'));
        console.log(ansiColors.gray(`  Models: ${dependencyTree.models.size}`));
        console.log(ansiColors.gray(`  Containers: ${dependencyTree.containers.size}`));
        console.log(ansiColors.gray(`  Content: ${dependencyTree.content.size}`));
        console.log(ansiColors.gray(`  Templates: ${dependencyTree.templates.size}`));
        console.log(ansiColors.gray(`  Pages: ${dependencyTree.pages.size}`));
        console.log(ansiColors.gray(`  Assets: ${dependencyTree.assets.size}`));
        console.log(ansiColors.gray(`  Galleries: ${dependencyTree.galleries.size}`));
        
        // Filter source data to only include entities in dependency tree
        sourceData = this.filterSourceDataByDependencyTree(sourceData, dependencyTree);
        
        // Re-check if we have content after filtering
        hasContent = Object.values(sourceData).some((arr: any) => Array.isArray(arr) && arr.length > 0);
        if (!hasContent) {
          console.log(ansiColors.yellow("⚠️ No content found after model filtering"));
          return;
        }
        
        console.log(ansiColors.green('✅ Source data filtered to model dependencies'));
      }

      // Set up reference mapper - gets config from state internally
      referenceMapper = new ReferenceMapper();

      // Execute sync operation and capture results
      const syncResults = await this.executePushersInOrder(sourceData, referenceMapper, state.elements.split(","));

      // Execute auto-publishing if --publish flag is set
      if (state.publish && (syncResults.publishableContentIds.length > 0 || syncResults.publishablePageIds.length > 0)) {
        console.log(ansiColors.cyan(`\n🚀 Auto-publishing enabled - starting batch publishing...`));
        
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
            console.log(ansiColors.green(`✅ Auto-publishing completed successfully: ${totalPublished} items published`));
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
              ((syncResults.totalSuccess + syncResults.totalSkipped) / totalSourceEntities) * 100
            )
          : 100;

      // Enhanced reporting using sync results
      console.log(ansiColors.cyan(`\n📊 Sync Operation Summary:`));
      console.log(
        ansiColors.gray(`Total Source Entities: ${ansiColors.white(totalSourceEntities.toString())}, `) +
          ansiColors.gray(`Success: ${ansiColors.green(syncResults.totalSuccess.toString())}, `) +
          ansiColors.gray(`Skipped: ${ansiColors.white(syncResults.totalSkipped.toString())}, `) +
          ansiColors.gray(`Failed: ${ansiColors.red(syncResults.totalFailures.toString())}, `) +
          ansiColors.gray(`Reconciliation: ${ansiColors.bold.white(reconciliationPercentage.toString() + "%")}`)
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
        this.originalConsoleLog(`\n📄 Sync log file written to: ${finalizedLogPath}\n`);
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
        console.log(ansiColors.gray(`[Content Processing] Using individual pusher (--no-batch enabled)`));
        return await pushContent(sourceData, referenceMapper);
      } else {
        // Use batch pusher for better performance (default behavior)
        console.log(ansiColors.gray(`[Content Processing] Using batch pusher (default behavior)`));
        
        // Set up batch processor with proper configuration
        const batchConfig = {
          apiClient: state.apiClient,
          targetGuid: state.targetGuid,
          locale: state.locale,
          referenceMapper,
          batchSize: 250, // Optimal batch size for normal content
          useContentFieldMapper: true, // Use enhanced field mapping
          models: sourceData.models, // Pass models for payload preparation
          defaultAssetUrl: '', // Will be determined by batch processor
        };
        
        const batchProcessor = new ContentBatchProcessor(batchConfig);
        const contentItems = sourceData.content || [];
        
        if (contentItems.length === 0) {
          return { status: 'success' as const, successful: 0, failed: 0, skipped: 0, publishableIds: [] };
        }
        
        try {
          const batchResult = await batchProcessor.processBatches(contentItems);
          
          // Convert batch result to expected PusherResult format
          return {
            status: (batchResult.failureCount > 0 ? 'error' : 'success') as 'success' | 'error',
            successful: batchResult.successCount,
            failed: batchResult.failureCount,
            skipped: 0, // Batch processor doesn't track skipped items separately
            publishableIds: batchResult.publishableIds
          };
        } catch (batchError: any) {
          console.error(ansiColors.red(`❌ Batch processing failed: ${batchError.message}`));
          console.log(ansiColors.yellow(`🔄 Falling back to individual processing...`));
          return await pushContent(sourceData, referenceMapper);
        }
      }
    };

    // ULTIMATE OPTIMIZATION: Embed functions directly in config (eliminates separate map)
    const pusherConfig = [
      { element: 'Models', dataKey: 'models', name: 'Models', pusher: pushModels },
      { element: 'Galleries', dataKey: 'galleries', name: 'Galleries', pusher: pushGalleries },
      { element: 'Assets', dataKey: 'assets', name: 'Assets', pusher: pushAssets },
      { element: 'Containers', dataKey: 'containers', name: 'Containers', pusher: pushContainers },
      { element: 'Content', dataKey: 'content', name: 'Content Items', pusher: smartContentPusher },
      { element: 'Templates', dataKey: 'templates', name: 'Templates', pusher: pushTemplates },
      { element: 'Pages', dataKey: 'pages', name: 'Pages', pusher: pushPages }
    ];

    try {
      for (const config of pusherConfig) {
        const data = sourceData[config.dataKey];
        
        // Skip if no data or element not requested
        if (data.length === 0 || !elements.includes(config.element)) {
          continue;
        }

        console.log(ansiColors.cyan(`\n📄 Pushing ${config.name}...`));

        // ULTIMATE OPTIMIZATION: Direct function execution from config with unified parameters
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
        console.log(
          ansiColors.gray(`${config.name}: `) +
          ansiColors.green(`${pusherResult.successful} successful, `) +
          ansiColors.white(`${pusherResult.skipped} skipped, `) +
          ansiColors.red(`${pusherResult.failed} failed`)
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
    console.log(ansiColors.cyan('🔍 Filtering source data by dependency tree...'));
    
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