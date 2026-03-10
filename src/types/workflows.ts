/**
 * Workflow Types
 * 
 * Type definitions for batch workflow operations, mappings, and publish status checking.
 */

import { WorkflowOperationType } from '@agility/management-sdk';

// Re-export WorkflowOperationType for convenience
export { WorkflowOperationType };

// ============================================================================
// Batch Workflow Types
// ============================================================================

/**
 * Result from a batch workflow operation
 */
export interface BatchWorkflowResult {
    success: boolean;
    processedIds: number[];
    failedCount: number;
    batchId?: number; // The batch ID from the API
    error?: string;
    /** Partial success details when some items succeed and some fail */
    partialSuccess?: {
        successCount: number;
        failureCount: number;
        batchId: number;
    };
}

/**
 * Combined result from workflow orchestration
 */
export interface WorkflowOrchestratorResult {
    success: boolean;
    contentResults: {
        total: number;
        processed: number;
        failed: number;
        batches: number;
        processedIds: number[];
    };
    pageResults: {
        total: number;
        processed: number;
        failed: number;
        batches: number;
        processedIds: number[];
    };
    errors: string[];
    logLines: string[];
}

/**
 * Options for workflow operations
 */
export interface WorkflowOptions {
    processContent: boolean;
    processPages: boolean;
    locale: string;
    operation: WorkflowOperationType;
}

/**
 * Result from a workflow operation command
 */
export interface WorkflowOperationResult {
    success: boolean;
    contentProcessed: number;
    contentFailed: number;
    pagesProcessed: number;
    pagesFailed: number;
    elapsedTime: number;
    errors: string[];
    operation: string;
}

// ============================================================================
// Mapping Types
// ============================================================================

/**
 * Content item mapping between source and target instances
 */
export interface ContentMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceContentID: number;
    targetContentID: number;
    sourceVersionID: number;
    targetVersionID: number;
}

/**
 * Page mapping between source and target instances
 */
export interface PageMapping {
    sourceGuid: string;
    targetGuid: string;
    sourcePageID: number;
    targetPageID: number;
    sourceVersionID: number;
    targetVersionID: number;
    sourcePageTemplateName: string | null;
    targetPageTemplateName: string | null;
}

/**
 * Result from reading mappings
 */
export interface MappingReadResult {
    contentIds: number[];
    pageIds: number[];
    contentMappings: ContentMapping[];
    pageMappings: PageMapping[];
    errors: string[];
}

/**
 * Result from updating mappings after publishing
 */
export interface MappingUpdateResult {
    contentMappingsUpdated: number;
    pageMappingsUpdated: number;
    errors: string[];
}

// ============================================================================
// Publish Status Types
// ============================================================================

/**
 * Item state values from the Agility CMS ItemState enum
 */
export enum ItemState {
    New = -1,
    None = 0,
    Staging = 1,
    Published = 2,
    Deleted = 3,
    Approved = 4,
    AwaitingApproval = 5,
    Declined = 6,
    Unpublished = 7
}

/**
 * Source item data structure for publish status checking
 */
export interface SourceItemData {
    contentID?: number;
    pageID?: number;
    properties: {
        state: number;
        modified: string;
        versionID: number;
    };
}

/**
 * Result from checking publish status of source items
 */
export interface PublishStatusResult {
    publishedContentIds: number[];
    unpublishedContentIds: number[];
    publishedPageIds: number[];
    unpublishedPageIds: number[];
    errors: string[];
}
