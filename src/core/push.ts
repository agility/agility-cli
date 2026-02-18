import * as path from "path";
import * as fs from "fs";
import { getState, initializeLogger, finalizeLogger, getLogger, state, setState, clearFailedContentRegistry, getPageCmsLink, getContentCmsLink } from "./state";
import ansiColors from "ansi-colors";
import { markPushStart, clearTimestamps } from "../lib/incremental";

import { Pushers, PushResults } from "../lib/pushers/orchestrate-pushers";
import { Pull } from "./pull";

export class Push {
  private pushers: Pushers;

  constructor() {
    // Initialize pusher orchestrator (pure business logic)
    this.pushers = new Pushers();
  }

  async pushInstances(fromSync: boolean = false): Promise<{ success: boolean; results: any[]; elapsedTime: number }> {
    const { isSync, sourceGuid, targetGuid, models, modelsWithDeps, autoPublish } = state;
    
    // Clear failed content registry from any previous sync
    clearFailedContentRegistry();
    
    // Initialize logger for push operation
    // Determine if this is a sync operation by checking if both source and target GUIDs exist
    initializeLogger(isSync ? "sync" : "push");
    const logger = getLogger();

    // TODO: Add support for multiple GUIDs, multiple locales, multiple chanels
    // Currently only supports one GUID, one locale, one channel
    // Get all GUIDs to process (both source and target)
    const allGuids = [...sourceGuid, ...targetGuid];

    if (allGuids.length === 0) {
      throw new Error("No GUIDs specified for push operation");
    }

    // IMPORTANT: For sync operations, we need ALL elements downloaded to enable proper change detection
    // Model filtering happens at the processing level, not the download level
    const {  } = state;
    if (models && models.trim().length > 0 && (!modelsWithDeps || modelsWithDeps.trim().length === 0)) {
      // For simple --models flag (not --models-with-deps), we can restrict downloads to save time
      // But for sync operations, we still need all elements for change detection
      if (!isSync) {
        const { setState } = await import("./state");
        setState({ elements: 'Models' });
      }
      // For sync operations, leave elements as default to download everything
    }


    // pull the instance data
    const pull = new Pull();
    await pull.pullInstances(true);
    
    // Re-initialize logger after pull operation (pull finalizes its logger)
    initializeLogger(isSync ? "sync" : "push");
    
    // CONSOLE.LOG - Calculate total operations using per-GUID locale mapping
    let totalOperations = 0;
    const operationDetails: string[] = [];
    for (const guid of allGuids) {
      const guidLocales = state.guidLocaleMap.get(guid) || ["en-us"];
      totalOperations += guidLocales.length;
      operationDetails.push(`${guid}: ${guidLocales.join(", ")}`);
    }
    // operationDetails.forEach(detail => console.log(`${detail}`));

    // Handle --reset flag: completely delete GUID folders and start fresh
    if (state.reset) {
      for (const guid of allGuids) {
        await this.handleResetFlag(guid);
      }
    }

    // Mark the start of this pull operation for incremental tracking
    markPushStart();
    const totalStartTime = Date.now();

    try {
      // Execute sequential pushes for all GUIDs, locales and channels (sitemaps)
      const results = await this.pushers.instanceOrchestrator();

      const totalElapsedTime = Date.now() - totalStartTime;

      // Calculate success/failure counts
      let totalSuccessful = 0;
      let totalFailed = 0;

      results.forEach((result: PushResults) => {
        if (result.failed?.length > 0) {
          totalFailed++;
        } else {
          totalSuccessful++;
        }
      });

      // Collect log file paths for display at the very end
      const logFilePaths = results
        .map(res => res.logFilePath)
        .filter(path => path) as string[];

      // Collect sync failure details from results for error summary
      let totalSyncFailures = 0;
      const syncErrors: Array<{ locale?: string; type: string; error: string }> = [];
      const syncFailureDetails: Array<{ name: string; error: string; type?: 'content' | 'page'; pageID?: number; contentID?: number; guid?: string; locale?: string }> = [];
      
      results.forEach((result: PushResults) => {
        // Track item-level failures from totalFailures
        if (result.totalFailures > 0) {
          totalSyncFailures += result.totalFailures;
        }
        // Collect individual failure details
        if (result.failureDetails && result.failureDetails.length > 0) {
          syncFailureDetails.push(...result.failureDetails);
        }
        // Track operation-level failures
        if (result.failed && result.failed.length > 0) {
          result.failed.forEach(f => {
            syncErrors.push({ type: 'sync', error: `${f.operation}: ${f.error}` });
          });
        }
      });

      // Calculate overall success - check both operation failures and item failures
      const success = totalFailed === 0 && totalSyncFailures === 0;

      // Use the orchestrator summary function to handle completion logic
      // But DON'T show log files yet - we'll show them at the very end
      const logger = getLogger();
      if (logger) {
        logger.orchestratorSummary(results, totalElapsedTime, success, []); // Empty array = no log files shown yet
      }

      finalizeLogger(); // Finalize global logger if it exists

      // Track all errors for final summary
      let autoPublishErrors: Array<{ locale: string; type: string; error: string }> = [];

      // Auto-publish if enabled (failures are expected and shouldn't block publish)
      if (isSync && autoPublish) {
        autoPublishErrors = await this.executeAutoPublish(results, autoPublish);
      }

      // Final error summary - show if there were ANY failures (sync or auto-publish)
      const hasFailures = totalSyncFailures > 0 || syncErrors.length > 0 || autoPublishErrors.length > 0;
      
      if (hasFailures) {
        console.log(ansiColors.red('\n' + '═'.repeat(50)));
        console.log(ansiColors.red('⚠️  ERROR SUMMARY'));
        console.log(ansiColors.red('═'.repeat(50)));
        
        // Show sync failure details line by line with links
        if (syncFailureDetails.length > 0) {
          console.log(ansiColors.red(`\n  Sync Failures (${syncFailureDetails.length}):`));
          syncFailureDetails.forEach(({ name, error, type, pageID, contentID, guid, locale }) => {
            // Format: [guid][locale] • name: error
            const prefix = guid && locale ? `[${guid}][${locale}]` : guid ? `[${guid}]` : '';
            console.log(ansiColors.red(`    ${prefix} • ${name}: ${error}`));
            // Add link for page failures
            if (type === 'page' && pageID && guid && locale) {
              const pageLink = getPageCmsLink(guid, locale, pageID);
              console.log(ansiColors.gray(`      ${pageLink}`));
              // Also show content link if page failed due to missing content mapping
              if (contentID) {
                const contentLink = getContentCmsLink(guid, locale, contentID);
                console.log(ansiColors.gray(`      ${contentLink}`));
              }
            }
            // Add link for content failures
            if (type === 'content' && contentID && guid && locale) {
              const link = getContentCmsLink(guid, locale, contentID);
              console.log(ansiColors.gray(`      ${link}`));
            }
          });
        } else if (totalSyncFailures > 0) {
          // Fallback if no detailed failure info available
          console.log(ansiColors.red(`  Sync: ${totalSyncFailures} items failed (see details above)`));
        }
        
        // Show detailed sync errors (operation-level)
        if (syncErrors.length > 0) {
          console.log(ansiColors.red(`\n  Operation Errors:`));
          syncErrors.forEach(({ locale, type, error }) => {
            const localeDisplay = locale ? `[${locale}]` : '';
            console.log(ansiColors.red(`    • ${localeDisplay} ${type}: ${error}`));
          });
        }
        
        // Show auto-publish errors
        if (autoPublishErrors.length > 0) {
          console.log(ansiColors.red(`\n  Auto-Publish Errors:`));
          autoPublishErrors.forEach(({ locale, type, error }) => {
            const localeDisplay = locale ? `[${locale}]` : '';
            console.log(ansiColors.red(`    • ${localeDisplay} ${type}: ${error}`));
          });
        }
      }

      // Show log file paths at the very end
      if (logFilePaths.length > 0) {
        console.log(ansiColors.cyan('\n📄 Log Files:'));
        logFilePaths.forEach((path) => {
          console.log(`  ${path}`);
        });
      }
      
      // Only exit if not called from another operation
    
      return {
        success,
        results,
        elapsedTime: totalElapsedTime,
      };

    } catch (error: any) {
      console.error(ansiColors.red("\n❌ An error occurred during the push command:"), error);
      finalizeLogger(); // Finalize logger even on error
      
      // Only exit if not called from another operation
      // process.exit(1);
      
      throw error; // Let calling code handle error response
    }
  }

  /**
   * Execute auto-publish after sync completes
   * IMPORTANT: Publishes items per-locale since the batch workflow API requires a locale parameter
   * Returns array of errors for display in final summary
   */
  private async executeAutoPublish(results: PushResults[], autoPublishMode: string): Promise<Array<{ locale: string; type: string; error: string }>> {
    // Collect per-locale publishable IDs from sync results
    const contentIdsByLocale = new Map<string, number[]>();
    const pageIdsByLocale = new Map<string, number[]>();

    for (const result of results) {
      // Use per-locale tracking if available
      if (result.publishableContentIdsByLocale) {
        result.publishableContentIdsByLocale.forEach((ids, locale) => {
          const existing = contentIdsByLocale.get(locale) || [];
          contentIdsByLocale.set(locale, [...existing, ...ids]);
        });
      }
      if (result.publishablePageIdsByLocale) {
        result.publishablePageIdsByLocale.forEach((ids, locale) => {
          const existing = pageIdsByLocale.get(locale) || [];
          pageIdsByLocale.set(locale, [...existing, ...ids]);
        });
      }
    }

    // Determine what to publish based on mode
    const publishContent = autoPublishMode === 'content' || autoPublishMode === 'both';
    const publishPages = autoPublishMode === 'pages' || autoPublishMode === 'both';

    // Get all locales that have items to publish
    const allLocales = new Set<string>();
    if (publishContent) {
      Array.from(contentIdsByLocale.keys()).forEach(locale => allLocales.add(locale));
    }
    if (publishPages) {
      Array.from(pageIdsByLocale.keys()).forEach(locale => allLocales.add(locale));
    }

    if (allLocales.size === 0) {
      console.log(ansiColors.yellow('\n⚠️  Auto-publish: No items to publish from sync operation'));
      return [];
    }

    // Calculate totals for summary
    let totalContent = 0;
    let totalPages = 0;
    contentIdsByLocale.forEach((ids) => { if (publishContent) totalContent += new Set(ids).size; });
    pageIdsByLocale.forEach((ids) => { if (publishPages) totalPages += new Set(ids).size; });

    console.log(ansiColors.cyan('\n' + '═'.repeat(50)));
    console.log(ansiColors.cyan('🚀 AUTO-PUBLISH'));
    console.log(ansiColors.cyan('═'.repeat(50)));
    console.log(ansiColors.gray(`Mode: ${autoPublishMode}`));
    console.log(ansiColors.gray(`Locales to publish: ${Array.from(allLocales).join(', ')}`));
    console.log(ansiColors.gray(`Total content items: ${totalContent}`));
    console.log(ansiColors.gray(`Total pages: ${totalPages}`));

    // Import workflow dependencies
    const { processBatches } = await import('../lib/workflows/process-batches');
    const { WorkflowOperationType } = await import('../types');
    const { updateMappingsAfterPublish } = await import('../lib/mappers/mapping-version-updater');
    const { waitForFetchApiSync } = await import('../lib/shared/get-fetch-api-status');

    // Track all errors for summary
    const allErrors: { locale: string; type: string; error: string }[] = [];
    // Track all published IDs for mappings refresh
    const publishedContentIdsByLocale = new Map<string, number[]>();
    const publishedPageIdsByLocale = new Map<string, number[]>();

    try {
      // Process each locale separately - this is CRITICAL because the batch workflow API
      // requires a locale parameter to publish the correct locale-specific content
      for (const locale of Array.from(allLocales)) {
        const contentIds = publishContent ? Array.from(new Set(contentIdsByLocale.get(locale) || [])) : [];
        const pageIds = publishPages ? Array.from(new Set(pageIdsByLocale.get(locale) || [])) : [];

        if (contentIds.length === 0 && pageIds.length === 0) {
          continue;
        }

        console.log(ansiColors.cyan(`\n─── Publishing ${locale} ───`));
        console.log(ansiColors.gray(`  Content: ${contentIds.length} items, Pages: ${pageIds.length} items`));

        const errors: string[] = [];
        const publishedContentIds: number[] = [];
        const publishedPageIds: number[] = [];

        // Publish content for this locale
        if (contentIds.length > 0) {
          const contentResult = await processBatches(contentIds, 'content', locale, WorkflowOperationType.Publish, errors);
          publishedContentIds.push(...contentResult.processedIds);
          if (contentResult.failed > 0) {
            console.log(ansiColors.yellow(`  ⚠️ ${contentResult.failed} content items failed`));
          }
        }

        // Publish pages for this locale
        if (pageIds.length > 0) {
          const pageResult = await processBatches(pageIds, 'pages', locale, WorkflowOperationType.Publish, errors);
          publishedPageIds.push(...pageResult.processedIds);
          if (pageResult.failed > 0) {
            console.log(ansiColors.yellow(`  ⚠️ ${pageResult.failed} pages failed`));
          }
        }

        // Track published IDs for mappings refresh
        if (publishedContentIds.length > 0) {
          publishedContentIdsByLocale.set(locale, publishedContentIds);
        }
        if (publishedPageIds.length > 0) {
          publishedPageIdsByLocale.set(locale, publishedPageIds);
        }

        // Collect errors for summary
        errors.forEach(err => {
          allErrors.push({ locale, type: 'publish', error: err });
        });
      }

      console.log(ansiColors.green('\n✓ Auto-publish complete'));

      // Refresh target instance data and update mappings after publishing
      // This ensures the mappings are up-to-date with the newly published content
      const targetGuid = state.targetGuid?.[0];
      const sourceGuid = state.sourceGuid?.[0];
      
      if (targetGuid && sourceGuid) {
        const hasPublishedItems = publishedContentIdsByLocale.size > 0 || publishedPageIdsByLocale.size > 0;
        
        if (hasPublishedItems) {
          // Step 1: Wait for Fetch API sync to complete (ONCE for all locales)
          console.log(ansiColors.cyan('\nRefreshing target instance data...'));
          try {
            await waitForFetchApiSync(targetGuid, 'fetch', false);
          } catch (error: any) {
            console.log(ansiColors.yellow(`  ⚠️ Could not check Fetch API status: ${error.message}`));
            // Continue anyway - status check is best-effort
          }
          
          // Step 2: Do ONE pull to refresh target data (ONCE for all locales)
          const pull = new Pull();
          const pullResult = await pull.pullInstances(true);
          
          if (!pullResult.success) {
            console.log(ansiColors.yellow('  ⚠️ Target refresh failed - skipping mapping version updates'));
            console.log(ansiColors.gray('     Run a manual pull to refresh data and update mappings'));
          } else {
            console.log(ansiColors.green('✓ Target instance data refreshed'));
            
            // Step 3: Update mappings for each locale that had published items
            for (const locale of Array.from(allLocales)) {
              const contentIds = publishedContentIdsByLocale.get(locale) || [];
              const pageIds = publishedPageIdsByLocale.get(locale) || [];
              
              if (contentIds.length > 0 || pageIds.length > 0) {
                try {
                  const mappingResult = await updateMappingsAfterPublish(
                    contentIds,
                    pageIds,
                    sourceGuid,
                    targetGuid,
                    locale
                  );
                  
                  // Log any mapping errors
                  if (mappingResult.result.errors.length > 0) {
                    mappingResult.result.errors.forEach(err => {
                      allErrors.push({ 
                        locale, 
                        type: 'mapping', 
                        error: err 
                      });
                    });
                  }
                } catch (refreshError: any) {
                  allErrors.push({ 
                    locale, 
                    type: 'refresh', 
                    error: `Mappings update failed: ${refreshError.message}` 
                  });
                }
              }
            }
          }
        }
      }

    } catch (error: any) {
      console.error(ansiColors.red(`\n❌ Auto-publish failed: ${error.message}`));
      allErrors.push({ locale: 'all', type: 'fatal', error: error.message });
    }

    // Return errors for display in final summary
    return allErrors;
  }

  private async handleResetFlag(guid: string): Promise<void> {
    const state = getState();
    const guidFolderPath = path.join(process.cwd(), state.rootPath, guid);

    if (fs.existsSync(guidFolderPath)) {
      console.log(ansiColors.red(`🔄 --reset flag detected: Deleting entire instance folder ${guidFolderPath}`));

      try {
        fs.rmSync(guidFolderPath, { recursive: true, force: true });
        console.log(ansiColors.green(`✓ Successfully deleted instance folder: ${guidFolderPath}`));
      } catch (resetError: any) {
        console.error(ansiColors.red(`✗ Error deleting instance folder: ${resetError.message}`));
        throw resetError;
      }
    } else {
      console.log(ansiColors.yellow(`⚠️ Instance folder ${guidFolderPath} does not exist (already clean)`));
    }

    // Clear timestamp tracking for this instance
    clearTimestamps(guid, state.rootPath);
  }
}
