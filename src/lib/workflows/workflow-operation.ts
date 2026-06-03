/**
 * Workflow Operation Core Module
 * 
 * Standalone module that reads mappings from the filesystem and performs
 * workflow operations (publish, unpublish, approve, decline, requestApproval)
 * on content and pages in the target instance.
 */

import ansiColors from 'ansi-colors';
import { state, initializeLogger, finalizeLogger, getLogger } from '../../core/state';
import { readMappingsForGuidPair, getMappingSummary } from '../mappers/mapping-reader';
import { parseWorkflowOptions, parseOperationType } from './workflow-options';
import { getOperationName } from './workflow-helpers';
import { workflowOrchestrator } from './workflow-orchestrator';
import { listMappings } from './list-mappings';
import { refreshAndUpdateMappings } from './refresh-mappings';
import { checkSourcePublishStatus } from '../shared/source-publish-status-checker';
import { WorkflowOperationResult, WorkflowOperationType } from '../../types';

// Re-export type for convenience
export { WorkflowOperationResult };

export class WorkflowOperation {
    /**
     * Execute workflow operation from mapping files
     */
    async executeFromMappings(): Promise<WorkflowOperationResult> {
        const startTime = Date.now();
        
        // Initialize logger
        initializeLogger('push');
        const logger = getLogger();

        // Get operation type from state
        const operationType = parseOperationType(state.operationType);
        const operationName = getOperationName(operationType);

        const result: WorkflowOperationResult = {
            success: true,
            contentProcessed: 0,
            contentFailed: 0,
            pagesProcessed: 0,
            pagesFailed: 0,
            elapsedTime: 0,
            errors: [],
            operation: operationName
        };

        try {
            const { sourceGuid, targetGuid, locale: locales } = state;

            // Validate required parameters
            if (!sourceGuid || sourceGuid.length === 0) {
                throw new Error('Source GUID is required. Use --sourceGuid flag.');
            }
            if (!targetGuid || targetGuid.length === 0) {
                throw new Error('Target GUID is required. Use --targetGuid flag.');
            }
            if (!locales || locales.length === 0) {
                throw new Error('At least one locale is required. Use --locale flag.');
            }

            const source = sourceGuid[0];
            const target = targetGuid[0];
            const primaryLocale = locales[0];

            console.log(ansiColors.cyan('\n' + '═'.repeat(50)));
            console.log(ansiColors.cyan(`📦 WORKFLOW OPERATION: ${operationName.toUpperCase()}`));
            console.log(ansiColors.cyan('═'.repeat(50)));
            console.log(ansiColors.gray(`Source: ${source}`));
            console.log(ansiColors.gray(`Target: ${target}`));
            console.log(ansiColors.gray(`Locales: ${locales.join(', ')}`));
            console.log(ansiColors.gray(`Operation: ${operationName}`));

            // Get mapping summary
            const summary = getMappingSummary(source, target, locales);
            // Check if explicit IDs are provided (bypasses mappings lookup)
            const hasExplicitContentIDs = state.explicitContentIDs && state.explicitContentIDs.length > 0;
            const hasExplicitPageIDs = state.explicitPageIDs && state.explicitPageIDs.length > 0;
            const useExplicitIDs = hasExplicitContentIDs || hasExplicitPageIDs;

            // Parse workflow options - process both content and pages by default
            const options = parseWorkflowOptions(true, primaryLocale);
            if (!options) {
                throw new Error('Failed to parse workflow options');
            }
            
            // Override with the actual operation type from state
            options.operation = operationType;

            let contentIds: number[];
            let pageIds: number[];

            if (useExplicitIDs) {
                // Explicit IDs mode - bypass mappings lookup but still check source publish status
                console.log(ansiColors.cyan('\n🔧 Using explicit IDs (bypassing mappings lookup)'));
                
                let explicitContentIds = hasExplicitContentIDs ? state.explicitContentIDs : [];
                let explicitPageIds = hasExplicitPageIDs ? state.explicitPageIDs : [];

                console.log(ansiColors.gray(`  Explicit content IDs: ${explicitContentIds.length > 0 ? explicitContentIds.join(', ') : '(none)'}`));
                console.log(ansiColors.gray(`  Explicit page IDs: ${explicitPageIds.length > 0 ? explicitPageIds.join(', ') : '(none)'}`));

                if (explicitContentIds.length === 0 && explicitPageIds.length === 0) {
                    console.log(ansiColors.yellow('\n⚠️ No valid IDs provided.'));
                    result.elapsedTime = Date.now() - startTime;
                    return result;
                }

                // For publish operations, check source publish status even with explicit IDs
                if (operationType === WorkflowOperationType.Publish) {
                    console.log(ansiColors.cyan('\nChecking source instance publish status for explicit IDs...'));
                    
                    // Read mappings to get source→target relationships (needed for reverse lookup)
                    const mappingResult = readMappingsForGuidPair(source, target, locales);
                    
                    // Create reverse lookup maps (target ID → source mapping)
                    const targetToSourceContent = new Map<number, any>();
                    const targetToSourcePage = new Map<number, any>();
                    
                    for (const mapping of mappingResult.contentMappings) {
                        targetToSourceContent.set(mapping.targetContentID, mapping);
                    }
                    for (const mapping of mappingResult.pageMappings) {
                        targetToSourcePage.set(mapping.targetPageID, mapping);
                    }
                    
                    // Filter explicit IDs to only those that have mappings
                    const contentMappingsForExplicit = explicitContentIds
                        .filter(id => targetToSourceContent.has(id))
                        .map(id => targetToSourceContent.get(id));
                    const pageMappingsForExplicit = explicitPageIds
                        .filter(id => targetToSourcePage.has(id))
                        .map(id => targetToSourcePage.get(id));
                    
                    // Check source publish status
                    const publishStatus = checkSourcePublishStatus(
                        contentMappingsForExplicit,
                        pageMappingsForExplicit,
                        source,
                        locales
                    );
                    
                    // Report filtering results
                    const contentPublishedInSource = publishStatus.publishedContentIds.length;
                    const pagesPublishedInSource = publishStatus.publishedPageIds.length;
                    const contentSkipped = publishStatus.unpublishedContentIds.length;
                    const pagesSkipped = publishStatus.unpublishedPageIds.length;
                    
                    console.log(ansiColors.gray(`Content: ${contentPublishedInSource}/${explicitContentIds.length} published in source (${contentSkipped} staging/unpublished skipped)`));
                    console.log(ansiColors.gray(`Pages: ${pagesPublishedInSource}/${explicitPageIds.length} published in source (${pagesSkipped} staging/unpublished skipped)`));
                    
                    // Use only IDs that are published in source
                    contentIds = publishStatus.publishedContentIds;
                    pageIds = publishStatus.publishedPageIds;
                } else {
                    // For non-publish operations, use all explicit IDs
                    contentIds = explicitContentIds;
                    pageIds = explicitPageIds;
                }
            } else {
                // Standard mode - use mappings files
                console.log(ansiColors.gray(`\nMapping Summary:`));
                console.log(ansiColors.gray(`Content items: ${summary.totalContent}`));
                console.log(ansiColors.gray(`Pages: ${summary.totalPages}`));
                console.log(ansiColors.gray(`Locales with data: ${summary.localesFound.join(', ') || 'none'}`));

                if (summary.totalContent === 0 && summary.totalPages === 0) {
                    console.log(ansiColors.yellow('\n⚠️ No mappings found to process.'));
                    console.log(ansiColors.gray('   Run a sync operation first to create mappings, or use --contentIDs/--pageIDs to specify IDs directly.'));
                    result.elapsedTime = Date.now() - startTime;
                    return result;
                }

                // Read mappings
                const mappingResult = readMappingsForGuidPair(source, target, locales);
                
                if (mappingResult.errors.length > 0) {
                    console.log(ansiColors.yellow('\nWarnings during mapping read:'));
                    mappingResult.errors.forEach(err => console.log(ansiColors.yellow(`  - ${err}`)));
                }

                // For publish operations, check source publish status to filter only published items
                contentIds = mappingResult.contentIds;
                pageIds = mappingResult.pageIds;
                
                if (operationType === WorkflowOperationType.Publish) {
                    console.log(ansiColors.cyan('\nChecking source instance publish status...'));
                    const publishStatus = checkSourcePublishStatus(
                        mappingResult.contentMappings,
                        mappingResult.pageMappings,
                        source,
                        locales
                    );

                    // Report status check warnings
                    if (publishStatus.errors.length > 0) {
                        console.log(ansiColors.yellow(`${publishStatus.errors.length} items not found in source files (will be included)`));
                    }

                    // Report filtering results
                    const totalContentMapped = mappingResult.contentIds.length;
                    const totalPagesMapped = mappingResult.pageIds.length;
                    const contentPublishedInSource = publishStatus.publishedContentIds.length;
                    const pagesPublishedInSource = publishStatus.publishedPageIds.length;
                    const contentSkipped = publishStatus.unpublishedContentIds.length;
                    const pagesSkipped = publishStatus.unpublishedPageIds.length;

                    console.log(ansiColors.gray(`Content: ${contentPublishedInSource}/${totalContentMapped} published in source (${contentSkipped} staging/unpublished skipped)`));
                    console.log(ansiColors.gray(`Pages: ${pagesPublishedInSource}/${totalPagesMapped} published in source (${pagesSkipped} staging/unpublished skipped)`));

                    // Filter IDs based on publish mode AND source publish status
                    contentIds = options.processContent ? publishStatus.publishedContentIds : [];
                    pageIds = options.processPages ? publishStatus.publishedPageIds : [];
                } else {
                    // For non-publish operations, use all mapped IDs
                    contentIds = options.processContent ? mappingResult.contentIds : [];
                    pageIds = options.processPages ? mappingResult.pageIds : [];
                }
            }

            const modeDescription = options.processContent && options.processPages 
                ? 'content and pages' 
                : options.processContent 
                    ? 'content only' 
                    : 'pages only';

            console.log(ansiColors.cyan(`\n${operationName.charAt(0).toUpperCase() + operationName.slice(1)}ing ${modeDescription}...`));
            console.log(ansiColors.gray(`Content items to ${operationName}: ${contentIds.length}`));
            console.log(ansiColors.gray(`Pages to ${operationName}: ${pageIds.length}`));

            // DRY RUN: Show preview and exit without executing
            if (state.dryRun) {
                console.log(ansiColors.yellow('\n' + '═'.repeat(50)));
                console.log(ansiColors.yellow(`🔍 DRY RUN PREVIEW - ${operationName.toUpperCase()}`));
                console.log(ansiColors.yellow('═'.repeat(50)));
                console.log(ansiColors.gray('\nThe following items would be processed:'));
                
                if (contentIds.length > 0) {
                    console.log(ansiColors.cyan(`\n📄 Content Items (${contentIds.length}):`));
                    const displayContentIds = contentIds.slice(0, 20);
                    displayContentIds.forEach(id => console.log(ansiColors.white(`    • ID: ${id}`)));
                    if (contentIds.length > 20) {
                        console.log(ansiColors.gray(`    ... and ${contentIds.length - 20} more content items`));
                    }
                }
                
                if (pageIds.length > 0) {
                    console.log(ansiColors.cyan(`\n📑 Pages (${pageIds.length}):`));
                    const displayPageIds = pageIds.slice(0, 20);
                    displayPageIds.forEach(id => console.log(ansiColors.white(`    • ID: ${id}`)));
                    if (pageIds.length > 20) {
                        console.log(ansiColors.gray(`    ... and ${pageIds.length - 20} more pages`));
                    }
                }
                
                console.log(ansiColors.yellow('\n' + '─'.repeat(50)));
                console.log(ansiColors.yellow('⚠️  DRY RUN COMPLETE - No changes were made'));
                console.log(ansiColors.gray(`Remove --dryRun flag to execute the ${operationName} operation`));
                console.log(ansiColors.yellow('─'.repeat(50)));
                
                result.contentProcessed = contentIds.length;
                result.pagesProcessed = pageIds.length;
                result.elapsedTime = Date.now() - startTime;
                finalizeLogger();
                return result;
            }

            // Execute workflow operation
            console.log(ansiColors.cyan('\n' + '─'.repeat(50)));
            console.log(ansiColors.cyan(`🚀 ${operationName.toUpperCase()} PHASE (${modeDescription})`));
            console.log(ansiColors.cyan('─'.repeat(50)));

            const workflowResult = await workflowOrchestrator(contentIds, pageIds, options);

            // Update results
            result.contentProcessed = workflowResult.contentResults.processed;
            result.contentFailed = workflowResult.contentResults.failed;
            result.pagesProcessed = workflowResult.pageResults.processed;
            result.pagesFailed = workflowResult.pageResults.failed;
            result.success = workflowResult.success;
            result.errors = workflowResult.errors;

            // If items were published, refresh target instance data and update mappings
            if (operationType === WorkflowOperationType.Publish &&
                (workflowResult.contentResults.processed > 0 || workflowResult.pageResults.processed > 0)) {
                await refreshAndUpdateMappings(
                    workflowResult.contentResults.processedIds,
                    workflowResult.pageResults.processedIds,
                    source,
                    target,
                    primaryLocale,
                    workflowResult.logLines // Pass publish log lines to include in log file
                );
            }

            // Final summary
            result.elapsedTime = Date.now() - startTime;
            const totalProcessed = result.contentProcessed + result.pagesProcessed;
            const totalFailed = result.contentFailed + result.pagesFailed;
            const totalSeconds = Math.floor(result.elapsedTime / 1000);

            console.log(ansiColors.cyan('\n' + '═'.repeat(50)));
            console.log(ansiColors.cyan(`📊 ${operationName.toUpperCase()} COMPLETE`));
            console.log(ansiColors.cyan('═'.repeat(50)));
            console.log(ansiColors.green(`✓ Processed: ${totalProcessed} items`));
            if (totalFailed > 0) {
                console.log(ansiColors.red(`✗ Failed: ${totalFailed} items`));
            }
            console.log(ansiColors.gray(`Total time: ${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`));

            if (result.errors.length > 0) {
                console.log(ansiColors.yellow('\nErrors encountered:'));
                result.errors.forEach(err => console.log(ansiColors.red(`  - ${err}`)));
            }

        } catch (error: any) {
            result.success = false;
            result.errors.push(error.message);
            console.error(ansiColors.red(`\n❌ Workflow operation failed: ${error.message}`));
        }

        finalizeLogger();
        result.elapsedTime = Date.now() - startTime;
        return result;
    }

    /**
     * List available mapping pairs for workflow operations
     */
    listMappings(): void {
        listMappings();
    }
}
