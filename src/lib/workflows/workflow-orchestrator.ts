/**
 * Workflow Orchestrator
 * 
 * Orchestrates batch workflow operations for content items and pages.
 */

import ansiColors from 'ansi-colors';
import { processBatches } from './process-batches';
import { getOperationName, getOperationVerb } from './workflow-helpers';
import { WorkflowOrchestratorResult, WorkflowOptions } from '../../types';

/**
 * Helper to log to both console and capture lines
 */
function logLine(line: string, logLines: string[]): void {
    console.log(line);
    logLines.push(line);
}

/**
 * Orchestrate workflow operations for content items and pages
 * Processes items in batches and reports progress
 */
export async function workflowOrchestrator(
    contentIds: number[],
    pageIds: number[],
    options: WorkflowOptions
): Promise<WorkflowOrchestratorResult> {
    const errors: string[] = [];
    const logLines: string[] = [];
    const { locale, processContent, processPages, operation } = options;
    const operationName = getOperationName(operation);
    const operationVerb = getOperationVerb(operation);

    // Process content and pages
    const contentResults = processContent 
        ? await processBatches(contentIds, 'content', locale, operation, errors)
        : { total: 0, processed: 0, failed: 0, batches: 0, processedIds: [], logLines: [] };
    
    // Collect content log lines
    logLines.push(...contentResults.logLines);
    
    const pageResults = processPages
        ? await processBatches(pageIds, 'pages', locale, operation, errors)
        : { total: 0, processed: 0, failed: 0, batches: 0, processedIds: [], logLines: [] };
    
    // Collect page log lines
    logLines.push(...pageResults.logLines);

    // Summary
    const totalProcessed = contentResults.processed + pageResults.processed;
    const totalFailed = contentResults.failed + pageResults.failed;
    const totalRequested = contentResults.total + pageResults.total;
    const totalNested = totalProcessed > totalRequested ? totalProcessed - totalRequested : 0;

    if (totalRequested > 0) {
        if (totalNested > 0) {
            logLine(ansiColors.cyan(`\nWorkflow summary: ${totalProcessed} items ${operationVerb} (${totalRequested} requested + ${totalNested} nested)`), logLines);
        } else {
            logLine(ansiColors.cyan(`\nWorkflow summary: ${totalProcessed}/${totalRequested} items ${operationVerb} successfully`), logLines);
        }
        if (totalFailed > 0) {
            logLine(ansiColors.yellow(`   ${totalFailed} items failed`), logLines);
        }
    } else {
        logLine(ansiColors.gray(`\nNo items to ${operationName}`), logLines);
    }

    return {
        success: errors.length === 0,
        contentResults,
        pageResults,
        errors,
        logLines
    };
}
