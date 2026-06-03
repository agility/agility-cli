/**
 * Batch Workflows Core Service
 * 
 * Core batch workflow operations using the SDK's
 * BatchWorkflowContent and BatchWorkflowPages methods.
 * 
 * Supports: Publish, Unpublish, Approve, Decline, RequestApproval
 */

import { state, getApiClient } from './state';
import ansiColors from 'ansi-colors';
import { WorkflowOperationType, BatchWorkflowResult } from '../types';
import { getOperationName } from '../lib/workflows/workflow-helpers';

// Re-export types for convenience
export { WorkflowOperationType, BatchWorkflowResult };

// Re-export helpers from workflows folder
export { getOperationName, getOperationVerb, getOperationIcon } from '../lib/workflows/workflow-helpers';
export { parseWorkflowOptions, parseOperationType } from '../lib/workflows/workflow-options';

/**
 * Batch size for processing - smaller batches for workflow operations
 * to prevent API timeouts during publish/unpublish
 */
const BATCH_SIZE = 250;

/**
 * Progress indicator interval (log a dot every 2 seconds while waiting)
 */
const PROGRESS_INTERVAL_MS = 2000;

/**
 * Batch polling configuration - increased for workflow operations
 * 600 retries × 3s = 30 minutes max wait time
 */
const BATCH_POLL_MAX_RETRIES = 600;
const BATCH_POLL_INTERVAL_MS = 3000;

/**
 * Run a promise with progress indicator logging
 */
async function withProgressIndicator<T>(
    promise: Promise<T>, 
    label: string
): Promise<T> {
    let dotCount = 0;
    const startTime = Date.now();
    
    // Log progress dots while waiting
    const progressInterval = setInterval(() => {
        dotCount++;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        process.stdout.write(`.`);
        // Every 10 dots (20 seconds), log elapsed time
        if (dotCount % 10 === 0) {
            process.stdout.write(` (${elapsed}s)`);
        }
    }, PROGRESS_INTERVAL_MS);

    try {
        const result = await promise;
        clearInterval(progressInterval);
        if (dotCount > 0) {
            console.log(''); // New line after dots
        }
        return result;
    } catch (error) {
        clearInterval(progressInterval);
        if (dotCount > 0) {
            console.log(''); // New line after dots
        }
        throw error;
    }
}

/**
 * Extract detailed error message from various error formats
 */
function extractErrorDetails(error: any): string {
    // Check for nested error structures (common in SDK exceptions)
    if (error.innerError) {
        return extractErrorDetails(error.innerError);
    }
    
    // Check for response data from API
    if (error.response?.data) {
        if (typeof error.response.data === 'string') {
            return error.response.data;
        }
        if (error.response.data.message) {
            return error.response.data.message;
        }
        if (error.response.data.error) {
            return error.response.data.error;
        }
        return JSON.stringify(error.response.data);
    }
    
    // Check for status code
    if (error.response?.status) {
        return `HTTP ${error.response.status}: ${error.response.statusText || 'Unknown error'}`;
    }
    
    // Check for message property
    if (error.message) {
        return error.message;
    }
    
    // Fallback
    return String(error) || 'Unknown workflow error';
}

/**
 * Parse partial success from error data JSON
 * Returns {successCount, failureCount, totalItems} if parseable, null otherwise
 */
function parsePartialSuccessFromError(errorMessage: string): { 
    successCount: number; 
    failureCount: number; 
    totalItems: number;
    failedItems?: any[];
} | null {
    try {
        // Try to extract JSON from error message
        const jsonMatch = errorMessage.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const errorData = JSON.parse(jsonMatch[0]);
            if (typeof errorData.successCount === 'number' && typeof errorData.failureCount === 'number') {
                return {
                    successCount: errorData.successCount,
                    failureCount: errorData.failureCount,
                    totalItems: errorData.totalItems || errorData.successCount + errorData.failureCount,
                    failedItems: errorData.failedItems
                };
            }
        }
    } catch {
        // Not parseable as JSON with partial success info
    }
    return null;
}

/**
 * Custom batch polling with batch ID tracking and partial success handling
 * Polls until batch is complete or timeout, includes batch ID in all error messages
 */
/**
 * Create a simple progress bar string
 */
function createProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

async function pollBatchWorkflow(
    batchID: number,
    targetGuid: string,
    type: 'content' | 'pages',
    totalItems: number, // Total items in this batch for progress display
    maxRetries: number = BATCH_POLL_MAX_RETRIES,
    intervalMs: number = BATCH_POLL_INTERVAL_MS
): Promise<{ 
    success: boolean; 
    processedIds: number[]; 
    partialSuccess?: { successCount: number; failureCount: number; failedItems?: any[] };
    error?: string;
}> {
    const apiClient = getApiClient();
    let retryCount = 0;
    let lastBatchState = -1;
    const startTime = Date.now();
    
    while (retryCount < maxRetries) {
        try {
            const batch = await apiClient.batchMethods.getBatch(batchID, targetGuid);
            const batchType = type === 'content' ? 'Content' : 'Page';
            // BatchState.Processed = 3
            if (batch.batchState === 3) {
                // Clear the progress line and show completion
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                process.stdout.write(ansiColors.yellow.dim(`\r${batchType} batch ${batchID}: ${createProgressBar(100)} ${totalItems}/${totalItems} (${elapsed}s)\n`));
                
                // Batch completed - check for errors in errorData
                if (batch.errorData && batch.errorData.length > 0) {
                    // Try to parse partial success from error data
                    const partialSuccess = parsePartialSuccessFromError(batch.errorData);
                    
                    if (partialSuccess && partialSuccess.successCount > 0) {
                        // Partial success - some items succeeded
                        const processedIds: number[] = [];
                        if (batch.items && Array.isArray(batch.items)) {
                            batch.items.forEach((item: any) => {
                                if (item.itemID > 0 && !item.errorMessage) {
                                    processedIds.push(item.itemID);
                                }
                            });
                        }
                        
                        return {
                            success: true, // Treat as success since some items were processed
                            processedIds,
                            partialSuccess: {
                                successCount: partialSuccess.successCount,
                                failureCount: partialSuccess.failureCount,
                                failedItems: partialSuccess.failedItems
                            }
                        };
                    }
                    
                    // Full failure
                    return {
                        success: false,
                        processedIds: [],
                        error: `Batch ${batchID} completed with errors: ${batch.errorData}`
                    };
                }
                
                // Success - extract processed IDs
                const processedIds: number[] = [];
                if (batch.items && Array.isArray(batch.items)) {
                    batch.items.forEach((item: any) => {
                        if (item.itemID > 0) {
                            processedIds.push(item.itemID);
                        }
                    });
                }
                
                return { success: true, processedIds };
            }
            
            // Still processing - show progress with numItemsProcessed
            const numProcessed = typeof batch.numItemsProcessed === 'number' ? batch.numItemsProcessed : 0;
            const percentComplete = totalItems > 0 ? Math.round((numProcessed / totalItems) * 100) : 0;
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(ansiColors.yellow.dim(`\r${batchType} batch ${batchID}: ${createProgressBar(percentComplete)} ${numProcessed}/${totalItems} (${elapsed}s)        `));
            
            if (batch.batchState !== lastBatchState) {
                lastBatchState = batch.batchState;
            }
            
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            
        } catch (pollError: any) {
            // Network error during polling - retry
            retryCount++;
            if (retryCount >= maxRetries) {
                return {
                    success: false,
                    processedIds: [],
                    error: `Batch ${batchID} polling failed after ${maxRetries} retries: ${pollError.message}`
                };
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }
    
    // Timeout
    return {
        success: false,
        processedIds: [],
        error: `Batch ${batchID} timed out after ${Math.round(maxRetries * intervalMs / 60000)} minutes. Please check the Batches page in the Agility Content Manager app.`
    };
}

/**
 * Item type for batch workflow operations
 */
export type BatchItemType = 'content' | 'pages';

/**
 * Unified batch workflow operation for content items or pages
 * Uses custom polling with batch ID tracking for better error messages
 * 
 * @param ids - Array of IDs to process
 * @param locale - Target locale
 * @param operation - Workflow operation type
 * @param type - Item type: 'content' or 'pages'
 * @returns Promise with batch result
 */
export async function batchWorkflow(
    ids: number[],
    locale: string,
    operation: WorkflowOperationType,
    type: BatchItemType
): Promise<BatchWorkflowResult> {
    const label = type === 'content' ? 'content items' : 'pages';
    
    try {
        const apiClient = getApiClient();
        const targetGuid = state.targetGuid;

        if (!apiClient) {
            throw new Error('API client not available in state');
        }
        if (!targetGuid || targetGuid.length === 0) {
            throw new Error('Target GUID not available in state');
        }
        if (!locale) {
            throw new Error('Locale not available in state');
        }
        if (!ids || ids.length === 0) {
            throw new Error(`${label} IDs array is empty`);
        }

        // Call appropriate SDK method with returnBatchId=true for custom polling
        // Get batch ID immediately using returnBatchId=true
        const batchIdResult = type === 'content'
            ? await apiClient.contentMethods.batchWorkflowContent(ids, targetGuid[0], locale, operation, true)
            : await apiClient.pageMethods.batchWorkflowPages(ids, targetGuid[0], locale, operation, true);
        
        const batchID = Array.isArray(batchIdResult) ? batchIdResult[0] : batchIdResult;
        
        if (!batchID || batchID <= 0) {
            throw new Error(`Failed to create batch for ${label}`);
        }
        
        // Custom polling with batch ID tracking and progress display
        const pollResult = await pollBatchWorkflow(batchID, targetGuid[0], type, ids.length);
        
        if (pollResult.success) {
            // Handle partial success
            if (pollResult.partialSuccess) {
                const { successCount, failureCount, failedItems } = pollResult.partialSuccess;
                console.log(ansiColors.yellow(`\n    ⚠️ Batch ${batchID} completed with errors: ${successCount}/${successCount + failureCount} items succeeded`));
                
                // Log failed items details if available
                if (failedItems && failedItems.length > 0 && state.verbose) {
                    failedItems.forEach((item: any) => {
                        console.log(ansiColors.red(`      - Item ${item.itemId}: ${item.errorMessage || 'Unknown error'}`));
                    });
                }
                
                return {
                    success: true, // Partial success is still success
                    processedIds: pollResult.processedIds,
                    failedCount: failureCount,
                    batchId: batchID,
                    partialSuccess: {
                        successCount,
                        failureCount,
                        batchId: batchID
                    }
                };
            }
            
            return {
                success: true,
                processedIds: pollResult.processedIds,
                failedCount: 0,
                batchId: batchID
            };
        } else {
            // Full failure
            console.error(ansiColors.red(`\n    ❌ ${pollResult.error}`));
            return {
                success: false,
                processedIds: [],
                failedCount: ids.length,
                batchId: batchID,
                error: pollResult.error
            };
        }
    } catch (error: any) {
        // Log the full error for debugging
        const errorDetails = extractErrorDetails(error);
        console.error(ansiColors.red(`\n    ❌ Batch ${type} workflow failed: ${errorDetails}`));
        
        // Log additional error context if available
        if (error.response) {
            console.error(ansiColors.gray(`    Status: ${error.response.status}`));
            if (error.response.data) {
                console.error(ansiColors.gray(`    Response: ${JSON.stringify(error.response.data, null, 2).substring(0, 500)}`));
            }
        }
        if (error.stack && state.verbose) {
            console.error(ansiColors.gray(`    Stack: ${error.stack}`));
        }
        
        return {
            success: false,
            processedIds: [],
            failedCount: ids.length,
            error: errorDetails
            // No batchId here since we may have failed before getting one
        };
    }
}

/**
 * Create batches of items for processing
 */
export function createBatches<T>(items: T[], batchSize: number = BATCH_SIZE): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    return batches;
}
