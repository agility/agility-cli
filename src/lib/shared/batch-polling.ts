import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';

/**
 * Simple batch polling function - polls until batch status is 3 (complete)
 */
export async function pollBatchUntilComplete(
    apiClient: mgmtApi.ApiClient,
    batchID: number,
    targetGuid: string,
    originalPayloads?: any[], // Original payloads for error matching
    maxAttempts: number = 120, // 2 minutes at 2s intervals
    intervalMs: number = 2000 // 2 seconds
): Promise<any> {
    let attempts = 0;

    // console.log(`🔄 Polling batch ${batchID} until complete...`);

    while (attempts < maxAttempts) {
        try {
            // Use getBatch from management SDK
            const batchStatus = await apiClient.batchMethods.getBatch(batchID, targetGuid);
            
       
            if (!batchStatus) {
                console.warn(`No batch status returned for batch ${batchID} (attempt ${attempts + 1})`);
                attempts++;
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                continue;
            }

          
            if (batchStatus.batchState === 3) {
                console.log(`✅ Batch ${batchID} completed successfully`);
                    // check for batch item errors
                    if (Array.isArray(batchStatus.items)) {
                        batchStatus.items.forEach((item: any, index: number) => {
                            if(item.errorMessage) {
                                // show the error and the item separately
                                const itemClean = { ...item}
                                delete itemClean.errorMessage;
                                console.error(ansiColors.red(`⚠️ Item ${item.itemID} (index ${index}) failed with error: ${item.errorMessage}`));
                                console.log(ansiColors.gray.italic('📋 Batch Item Details:'));
                                console.log(ansiColors.gray.italic(JSON.stringify(itemClean, null, 2)));
                                
                                // FIFO matching: Show the original payload that caused this error
                                if (originalPayloads && originalPayloads[index]) {
                                    console.log(ansiColors.yellow.italic('🔍 Original Payload that Failed:'));
                                    console.log(ansiColors.yellow.italic(JSON.stringify(originalPayloads[index], null, 2)));
                                } else if (originalPayloads) {
                                    console.warn(ansiColors.yellow(`⚠️ Could not match payload at index ${index} (total payloads: ${originalPayloads.length})`));
                                }
                                
                                if (batchStatus.errorData) {
                                    console.log(ansiColors.red.italic('🔍 Additional Error Data:'));
                                    console.log(batchStatus.errorData + "\n");
                                }
                            }
                        });
                    }
                return batchStatus;
            } else {

                // Create a cycling dot pattern that resets every 3 attempts
                let dots = '.'.repeat((attempts % 3) + 1);
               
                console.error(ansiColors.yellow(`Batch ${batchID} in progress ${dots}`));
                if (batchStatus.errorData) {
                    console.error(`Error: ${batchStatus.errorData}`);
                }
            }
            
            attempts++;
            await new Promise(resolve => setTimeout(resolve, intervalMs));

        } catch (error: any) {
            console.warn(`⚠️ Error checking batch status (attempt ${attempts + 1}): ${error.message}`);
            attempts++;
            if (attempts >= maxAttempts) {
                throw new Error(`Failed to poll batch ${batchID} after ${maxAttempts} attempts: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }

    throw new Error(`Batch ${batchID} polling timed out after ${maxAttempts} attempts`);
}

/**
 * Extract results from completed batch
 */
export function extractBatchResults(batch: any, originalItems: any[]): { successfulItems: any[], failedItems: any[] } {
    const successfulItems: any[] = [];
    const failedItems: any[] = [];

    if (!batch?.items || !Array.isArray(batch.items)) {
        // All items failed if no items array
        return {
            successfulItems: [],
            failedItems: originalItems.map((item, index) => ({
                originalItem: item,
                error: 'No batch items returned',
                index
            }))
        };
    }

    // Process each batch item
    batch.items.forEach((item: any, index: number) => {
        const originalItem = originalItems[index];
        
        if (item.itemID > 0 && !item.itemNull) {
            // Successful item
            successfulItems.push({
                originalItem,
                newId: item.itemID,
                index
            });
        } else {
            // Failed item
            failedItems.push({
                originalItem,
                error: item.itemNull ? 'Item creation returned null' : `Invalid ID: ${item.itemID}`,
                index
            });
        }
    });

    return { successfulItems, failedItems };
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