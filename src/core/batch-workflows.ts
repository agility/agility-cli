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
 * Batch size for processing - prevents API throttling
 */
const BATCH_SIZE = 250;

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
 * Item type for batch workflow operations
 */
export type BatchItemType = 'content' | 'pages';

/**
 * Unified batch workflow operation for content items or pages
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

        // const operationName = getOperationName(operation);
        
        // Log the attempt for debugging
        // if (state.verbose) {
        //     console.log(ansiColors.gray(`${operationName}ing ${ids.length} ${label} to ${targetGuid[0]} (${locale})...`));
        // }

        // Call appropriate SDK method based on type
        const processedIds = type === 'content'
            ? await apiClient.contentMethods.batchWorkflowContent(ids, targetGuid[0], locale, operation, false)
            : await apiClient.pageMethods.batchWorkflowPages(ids, targetGuid[0], locale, operation, false);

        return {
            success: true,
            processedIds,
            failedCount: 0
        };
    } catch (error: any) {
        return {
            success: false,
            processedIds: [],
            failedCount: ids.length,
            error: extractErrorDetails(error)
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
