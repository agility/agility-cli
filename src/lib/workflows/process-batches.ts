/**
 * Process Batches
 * 
 * Processes items in batches with progress reporting and error handling.
 */

import ansiColors from 'ansi-colors';
import { batchWorkflow, createBatches, type BatchItemType } from '../../core/batch-workflows';
import { getOperationName, getOperationVerb } from './workflow-helpers';
import { WorkflowOperationType } from '../../types';
import { state, fileOperations } from '../../core';
import { getLogger } from '../../core/state';
import { getContentItemsFromFileSystem } from '../getters/filesystem/get-content-items';
import { getPagesFromFileSystem } from '../getters/filesystem/get-pages';

/**
 * Item info for display purposes
 */
interface ItemDisplayInfo {
    id: number;
    name: string;
    type?: string;
}

/**
 * Get content item display info from filesystem
 */
function getContentDisplayInfo(ids: number[], targetGuid: string, locale: string): Map<number, ItemDisplayInfo> {
    const displayMap = new Map<number, ItemDisplayInfo>();
    
    try {
        const fileOps = new fileOperations(targetGuid, locale);
        const contentItems = getContentItemsFromFileSystem(fileOps);
        
        for (const item of contentItems) {
            if (ids.includes(item.contentID)) {
                // Try to get a display name from fields.title, properties.referenceName, or definitionName
                const displayName = item.fields?.title 
                    || item.fields?.name 
                    || item.properties?.referenceName 
                    || `Item ${item.contentID}`;
                const modelName = item.properties?.definitionName || '';
                
                displayMap.set(item.contentID, {
                    id: item.contentID,
                    name: displayName,
                    type: modelName
                });
            }
        }
    } catch (error) {
        // Silently fail - we'll just show IDs without names
    }
    
    return displayMap;
}

/**
 * Get page display info from filesystem
 */
function getPageDisplayInfo(ids: number[], targetGuid: string, locale: string): Map<number, ItemDisplayInfo> {
    const displayMap = new Map<number, ItemDisplayInfo>();
    
    try {
        const fileOps = new fileOperations(targetGuid, locale);
        const pages = getPagesFromFileSystem(fileOps);
        
        for (const page of pages) {
            if (ids.includes(page.pageID)) {
                // Use title, name, or pageID as display
                const displayName = page.title || page.name || `Page ${page.pageID}`;
                const pagePath = page.name ? `/${page.name}` : '';
                
                displayMap.set(page.pageID, {
                    id: page.pageID,
                    name: displayName,
                    type: pagePath
                });
            }
        }
    } catch (error) {
        // Silently fail - we'll just show IDs without names
    }
    
    return displayMap;
}

/**
 * Helper to log to both console (via logger) and capture lines
 */
function logLine(line: string, logLines: string[]): void {
    const logger = getLogger();
    if (logger) {
        logger.info(line);
    } else {
        console.log(line);
    }
    logLines.push(line);
}

/**
 * Display all items being processed (no truncation)
 * Format: ● [guid][locale] content ID: {id} - Name (Type) - publishing
 */
function displayItemBreakdown(
    ids: number[], 
    type: BatchItemType,
    targetGuid: string,
    locale: string,
    operationName: string,
    displayMap: Map<number, ItemDisplayInfo>,
    logLines: string[]
): void {
    const entityType = type === 'content' ? 'content' : 'page';
    
    // Show ALL items - no truncation
    for (const id of ids) {
        const info = displayMap.get(id);
        const guidDisplay = ansiColors.green(`[${targetGuid}]`);
        const localeDisplay = ansiColors.gray(`[${locale}]`);
        const symbol = ansiColors.green('●');
        
        let line: string;
        if (info) {
            const typeDisplay = info.type ? ansiColors.gray(` (${info.type})`) : '';
            // Format: ● [guid][locale] content ID: {id} - Name (Type) - publishing
            line = `${symbol} ${guidDisplay}${localeDisplay} ${ansiColors.white(entityType)} ID: ${ansiColors.cyan.underline(String(id))} - ${ansiColors.white(info.name)}${typeDisplay} - ${ansiColors.gray(operationName.toLowerCase())}`;
        } else {
            line = `${symbol} ${guidDisplay}${localeDisplay} ${ansiColors.white(entityType)} ID: ${ansiColors.cyan.underline(String(id))} - ${ansiColors.gray(operationName.toLowerCase())}`;
        }
        logLine(line, logLines);
    }
}

/**
 * Batch processing result
 */
export interface BatchProcessingResult {
    total: number;
    processed: number;
    failed: number;
    batches: number;
    processedIds: number[];
    logLines: string[];
}

/**
 * Process batches for a specific item type (content or pages)
 */
export async function processBatches(
    ids: number[],
    type: BatchItemType,
    locale: string,
    operation: WorkflowOperationType,
    errors: string[]
): Promise<BatchProcessingResult> {
    const logLines: string[] = [];
    const results: BatchProcessingResult = { 
        total: ids.length, 
        processed: 0, 
        failed: 0, 
        batches: 0, 
        processedIds: [],
        logLines: []
    };
    
    if (ids.length === 0) return results;

    const label = type === 'content' ? 'Content' : 'Page';
    const operationName = getOperationName(operation);
    const operationVerb = getOperationVerb(operation);
    
    logLine(ansiColors.cyan(`\n${operationName}ing ${ids.length} ${label.toLowerCase()} items...`), logLines);
    
    // Get item display info and show breakdown (ALL items, no truncation)
    const targetGuid = state.targetGuid?.[0];
    if (targetGuid) {
        const displayMap = type === 'content' 
            ? getContentDisplayInfo(ids, targetGuid, locale)
            : getPageDisplayInfo(ids, targetGuid, locale);
        
        if (displayMap.size > 0) {
            displayItemBreakdown(ids, type, targetGuid, locale, operationName, displayMap, logLines);
        }
    }
    
    const batches = createBatches(ids);
    results.batches = batches.length;

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;
        const progress = Math.round((batchNum / batches.length) * 100);
        
        logLine(ansiColors.gray(`[${progress}%] ${label} batch ${batchNum}/${batches.length}: ${operationName}ing ${batch.length} items...`), logLines);

        try {
            const batchResult = await batchWorkflow(batch, locale, operation, type);
            
            if (batchResult.success) {
                results.processed += batchResult.processedIds.length;
                results.processedIds.push(...batchResult.processedIds);
            } else {
                results.failed += batch.length;
                errors.push(`${label} batch ${batchNum}: ${batchResult.error}`);
            }
        } catch (error: any) {
            results.failed += batch.length;
            errors.push(`${label} batch ${batchNum}: ${error.message}`);
        }

        // Small delay between batches to prevent throttling
        if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Display count - clarify when API processes more items than requested (nested content)
    let summaryLine: string;
    if (results.processed > results.total) {
        // API processed additional nested items
        summaryLine = ansiColors.green(`✓ ${label} ${operationVerb}: ${results.processed} items (${results.total} requested + ${results.processed - results.total} nested)`);
    } else if (results.processed === results.total) {
        summaryLine = ansiColors.green(`✓ ${label} ${operationVerb}: ${results.processed} items`);
    } else {
        // Some items failed or were skipped
        summaryLine = ansiColors.green(`✓ ${label} ${operationVerb}: ${results.processed}/${results.total} items`);
    }
    logLine(summaryLine, logLines);
    
    if (results.failed > 0) {
        logLine(ansiColors.red(`✗ ${results.failed} ${label.toLowerCase()} items failed`), logLines);
    }

    results.logLines = logLines;
    return results;
}
