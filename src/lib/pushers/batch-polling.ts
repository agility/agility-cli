import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';

/**
 * Extract the error message from a JSON error response or plain text
 * Handles both JSON format {"message":"..."} and plain text errors
 */
function extractErrorMessage(errorText: string): string {
    if (!errorText) return 'Unknown error';
    
    try {
        // Try to parse as JSON
        const parsed = JSON.parse(errorText);
        // Return just the message field if it exists
        if (parsed.message) {
            return parsed.message;
        }
        // Fallback to exceptionType if no message
        if (parsed.exceptionType) {
            return `${parsed.exceptionType}: ${parsed.message || 'No details'}`;
        }
        return errorText;
    } catch {
        // Not JSON, return as-is but truncate if too long
        // Also extract message from exception format: "ExceptionType: Message"
        const exceptionMatch = errorText.match(/^[\w.]+Exception:\s*(.+?)(?:\r?\n|$)/);
        if (exceptionMatch) {
            return exceptionMatch[1].trim();
        }
        return errorText.length > 200 ? errorText.substring(0, 200) + '...' : errorText;
    }
}

/**
 * Create a simple progress bar string
 */
function createProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Log batch errors using structured failedItems array (preferred) or legacy items array
 */
function logBatchErrors(batchStatus: any, originalPayloads?: any[]): void {
    // Prefer structured failedItems array from new API
    if (Array.isArray(batchStatus.failedItems) && batchStatus.failedItems.length > 0) {
        batchStatus.failedItems.forEach((failed: any) => {
            const batchItemId = failed.batchItemId ?? failed.batchItemID ?? '?';
            const errorType = failed.errorType || 'Error';
            const errorMessage = failed.errorMessage || 'Unknown error';
            const itemType = failed.itemType || 'Item';
            
            // Try to find the original payload by batchItemId to get referenceName
            let referenceName = 'unknown';
            if (originalPayloads) {
                // batchItemId typically corresponds to index in the batch
                const payload = originalPayloads.find((p, idx) => p?.batchItemId === batchItemId) 
                    || originalPayloads[batchStatus.failedItems.indexOf(failed)];
                referenceName = payload?.properties?.referenceName || payload?.referenceName || 'unknown';
            }
            
            console.error(ansiColors.red(`  ✗ ${itemType} ${batchItemId} (${referenceName}): ${errorMessage}`));
        });
        return;
    }
    
    // Fallback to legacy items array with errorMessage field
    if (Array.isArray(batchStatus.items)) {
        batchStatus.items.forEach((item: any, index: number) => {
            if (item.errorMessage) {
                const errorMessage = extractErrorMessage(item.errorMessage);
                const batchItemId = item.batchItemID || item.batchItemId || `idx:${index}`;
                const referenceName = originalPayloads?.[index]?.properties?.referenceName || 'unknown';
                
                console.error(ansiColors.red(`  ✗ Batch item ${batchItemId} (${referenceName}): ${errorMessage}`));
            }
        });
    }
}

/** BatchState.Processed = 3 */
const BATCH_STATE_PROCESSED = 3;

/**
 * Normalize batch response so we handle both camelCase (SDK) and PascalCase (.NET API).
 */
function normalizeBatchStatus(batchStatus: any): any {
    if (!batchStatus) return batchStatus;
    return {
        ...batchStatus,
        batchState: batchStatus.batchState ?? batchStatus.BatchState,
        numItemsProcessed: batchStatus.numItemsProcessed ?? batchStatus.NumItemsProcessed,
        percentComplete: batchStatus.percentComplete ?? batchStatus.PercentComplete,
        items: batchStatus.items ?? batchStatus.Items ?? [],
        errorData: batchStatus.errorData ?? batchStatus.ErrorData,
    };
}

/**
 * Derive number of processed items from batch status.
 * Uses numItemsProcessed when set by the API; otherwise counts from items array
 * (items with itemID > 0 or processedItemVersionID set are considered processed).
 */
function getNumProcessed(batchStatus: any): number {
    const num = batchStatus?.numItemsProcessed ?? batchStatus?.NumItemsProcessed;
    if (typeof num === 'number' && num >= 0) {
        return num;
    }
    const items = batchStatus?.items ?? batchStatus?.Items;
    if (!Array.isArray(items)) return 0;
    return items.filter((item: any) => {
        const id = item?.itemID ?? item?.itemId;
        const versionId = item?.processedItemVersionID ?? item?.processedItemVersionId;
        return (typeof id === 'number' && id > 0) || (versionId != null && versionId !== '');
    }).length;
}

/**
 * Simple batch polling function - polls until batch status is 3 (complete)
 */
export async function pollBatchUntilComplete(
    apiClient: mgmtApi.ApiClient,
    batchID: number,
    targetGuid: string,
    originalPayloads?: any[], // Original payloads for error matching
    maxAttempts: number = 300, // 10 minutes at 2s intervals - increased from 120
    intervalMs: number = 2000, // 2 seconds
    batchType?: string, // Type of batch for better logging
    totalItems?: number // Total items in batch for progress display
): Promise<any> {
    let attempts = 0;
    let consecutiveErrors = 0;
    const startTime = Date.now();
    // Default totalItems from originalPayloads if not provided
    const itemCount = totalItems ?? originalPayloads?.length ?? 0;

    // Show progress starting at 0 immediately so the bar doesn't jump on first poll
    const batchTypeStr = batchType ? `${batchType} batch` : 'Batch';
    const initialBar = createProgressBar(0);
    const initialLine =
        itemCount > 0
            ? `${batchTypeStr} ${batchID}: ${initialBar} 0/${itemCount} (0s)`
            : `${batchTypeStr} ${batchID}: ${initialBar} 0% (0s)`;
    process.stdout.write(ansiColors.yellow.dim(initialLine) + '    ');

    while (attempts < maxAttempts) {
        try {
            // Poll: get current batch status from API (expandItems=true by default in SDK)
            const raw = await apiClient.batchMethods.getBatch(batchID, targetGuid);
            const batchStatus = normalizeBatchStatus(raw);

            // Reset consecutive errors on successful API call
            consecutiveErrors = 0;

            if (!batchStatus) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                continue;
            }

            const state = batchStatus.batchState;
            if (state === BATCH_STATE_PROCESSED) {
                // Clear the in-place progress line before logging completion/errors
                process.stdout.write('\r' + ' '.repeat(80) + '\r');
                // Batch complete - log errors using structured failedItems if available
                logBatchErrors(batchStatus, originalPayloads);
                return batchStatus;
            }

            // Still in progress: show progress from this poll's response
            const batchTypeStr = batchType ? `${batchType} batch` : 'Batch';
            const numProcessed = getNumProcessed(batchStatus);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const pct = batchStatus.percentComplete;
            let line: string;
            if (itemCount > 0) {
                const percentComplete = Math.round((numProcessed / itemCount) * 100);
                const progressBar = createProgressBar(percentComplete);
                line = `${batchTypeStr} ${batchID}: ${progressBar} ${numProcessed}/${itemCount} (${elapsed}s)`;
            } else {
                const percentComplete = typeof pct === 'number' && pct >= 0 ? pct : 0;
                const progressBar = createProgressBar(percentComplete);
                line = `${batchTypeStr} ${batchID}: ${progressBar} ${percentComplete}% (${elapsed}s)`;
            }
            process.stdout.write('\r' + ansiColors.yellow.dim(line) + '    ');
            if (batchStatus.errorData) {
                console.log(`Error: ${batchStatus.errorData}`);
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, intervalMs));

        } catch (error: any) {
            consecutiveErrors++;
            console.warn(`⚠️ Error checking batch status (attempt ${attempts + 1}/${maxAttempts}, consecutive errors: ${consecutiveErrors}): ${error.message}`);
            
            // If we get too many consecutive errors, the batch might have failed
            if (consecutiveErrors >= 10) {
                console.warn(`⚠️ ${consecutiveErrors} consecutive errors - batch ${batchID} may have failed or been deleted`);
                
                // Try one more time with extended timeout before giving up
                try {
                    const finalRaw = await apiClient.batchMethods.getBatch(batchID, targetGuid);
                    const finalCheck = normalizeBatchStatus(finalRaw);
                    if (finalCheck?.batchState === BATCH_STATE_PROCESSED) {
                        console.log(`✅ Batch ${batchID} was actually successful! Polling errors were transient.`);
                        return finalCheck;
                    }
                } catch (finalError) {
                    console.warn(`Final batch check also failed: ${finalError.message}`);
                }
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
                process.stdout.write('\r' + ' '.repeat(80) + '\r\n');
                throw new Error(`Failed to poll batch ${batchID} after ${maxAttempts} attempts (${consecutiveErrors} consecutive errors): ${error.message}`);
            }
            
            // Exponential backoff for errors, but cap at 10 seconds
            const backoffMs = Math.min(intervalMs * Math.pow(1.5, consecutiveErrors), 10000);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
    }

    process.stdout.write('\r' + ' '.repeat(80) + '\r\n');
    throw new Error(`Batch ${batchID} polling timed out after ${maxAttempts} attempts (~${Math.round(maxAttempts * intervalMs / 60000)} minutes)`);
}

/**
 * Extract results from completed batch
 * Uses structured failedItems from new API if available, falls back to legacy items array
 */
export function extractBatchResults(batch: any, originalItems: any[]): { 
    successfulItems: any[], 
    failedItems: any[],
    summary?: { totalItems: number, successCount: number, failureCount: number, durationMs: number }
} {
    const successfulItems: any[] = [];
    const failedItems: any[] = [];
    
    // Extract summary info if available from new API
    const summary = batch?.totalItems !== undefined ? {
        totalItems: batch.totalItems,
        successCount: batch.successCount ?? 0,
        failureCount: batch.failureCount ?? 0,
        durationMs: batch.durationMs ?? 0
    } : undefined;

    // Use structured failedItems from new API if available
    if (Array.isArray(batch?.failedItems) && batch.failedItems.length > 0) {
        // Track which indices failed
        const failedBatchItemIds = new Set(batch.failedItems.map((f: any) => f.batchItemId ?? f.batchItemID));
        
        // Process failed items from structured array
        batch.failedItems.forEach((failed: any, idx: number) => {
            const batchItemId = failed.batchItemId ?? failed.batchItemID;
            // Try to match to original item - batchItemId might be 1-indexed or match some property
            const originalItem = originalItems[idx] || originalItems.find((item, i) => i === batchItemId - 1);
            
            failedItems.push({
                originalItem: originalItem || null,
                newItem: null,
                error: failed.errorMessage || 'Unknown error',
                errorType: failed.errorType,
                itemType: failed.itemType,
                batchItemId: batchItemId,
                index: idx
            });
        });
        
        // Remaining items are successful (from items array or inferred)
        if (Array.isArray(batch?.items)) {
            batch.items.forEach((item: any, index: number) => {
                const batchItemId = item.batchItemID || item.batchItemId;
                if (!failedBatchItemIds.has(batchItemId) && item.itemID > 0) {
                    successfulItems.push({
                        originalItem: originalItems[index],
                        newId: item.itemID,
                        newItem: item,
                        index
                    });
                }
            });
        }
        
        return { successfulItems, failedItems, summary };
    }

    // Fallback to legacy items array processing
    if (!batch?.items || !Array.isArray(batch.items)) {
        return {
            successfulItems: [],
            failedItems: originalItems.map((item, index) => ({
                originalItem: item,
                error: 'No batch items returned',
                index
            })),
            summary
        };
    }

    // Process each batch item (legacy)
    batch.items.forEach((item: any, index: number) => {
        const originalItem = originalItems[index];
        
        if (item.itemID > 0 && !item.itemNull) {
            successfulItems.push({
                originalItem,
                newId: item.itemID,
                newItem: item,
                index
            });
        } else {
            let errorMsg = 'Failed to create item';
            if (item.errorMessage) {
                errorMsg = extractErrorMessage(item.errorMessage);
            } else if (!item.itemNull) {
                errorMsg = `Invalid ID: ${item.itemID}`;
            }
            
            failedItems.push({
                originalItem,
                newItem: null,
                error: errorMsg,
                index
            });
        }
    });

    return { successfulItems, failedItems, summary };
} 


export function prettyException(error: string) {

// TODO: regex out the exception type and message
//     Item -1 failed with error: Agility.Shared.Exceptions.ManagementValidationException: The maximum length for the Message field is 1500 characters.
//    at Agility.Shared.Engines.BatchProcessing.BatchInsertContentitem(String languageCode, BatchImportContentItem batchImportContentItem) in D:\a\_work\1\s\Agility CMS 2014\Agility.Shared\Engines\BatchProcessing\BatchProcessing_InsertContentItem.cs:line 398
//    at Agility.Shared.Engines.BatchProcessing.BatchInsertContent(Batch batch) in D:\a\_work\1\s\Agility CMS 2014\Agility.Shared\Engines\BatchProcessing\BatchProcessing.cs:line 1212
    


    
}

/**
 * Enhanced error logging for batch items with payload matching
 * This helps identify which specific payload caused the error using FIFO matching
 */
export function logBatchError(
    batchItem: any,
    index: number,
    originalPayload?: any
): void {
    console.error(ansiColors.red(`⚠️ Item ${batchItem.itemID} (index ${index}) failed with error:`));
    console.error(ansiColors.red(batchItem.errorMessage));
    
    // Clean batch item for display
    const itemClean = { ...batchItem };
    delete itemClean.errorMessage;
    console.log(ansiColors.gray.italic('📋 Batch Item Details:'));
    console.log(ansiColors.gray.italic(JSON.stringify(itemClean, null, 2)));
    
    // Show the original payload that caused this error (FIFO matching)
    if (originalPayload) {
        console.log(ansiColors.yellow.italic('🔍 Original Payload that Failed:'));
        
        // Highlight key fields that might be causing issues
        const keyFields = ['properties', 'fields', 'contentID', 'referenceName'];
        const highlightedPayload: any = {};
        
        keyFields.forEach(field => {
            if (originalPayload[field] !== undefined) {
                highlightedPayload[field] = originalPayload[field];
            }
        });
        
        // Show highlighted fields first
        console.log(ansiColors.yellow.italic('Key Fields:'));
        console.log(ansiColors.yellow.italic(JSON.stringify(highlightedPayload, null, 2)));
        
        // Show full payload if needed for debugging
        console.log(ansiColors.gray.italic('Full Payload:'));
        console.log(ansiColors.gray.italic(JSON.stringify(originalPayload, null, 2)));
    }
}