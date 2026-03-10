/**
 * Publisher Functions - Simple SDK Mirroring
 * 
 * This module provides simple publisher functions that mirror the SDK patterns exactly.
 * These functions are lightweight wrappers around the Management SDK publishing methods.
 * 
 * NOTE: Batch workflow operations have been consolidated into src/core/batch-workflows.ts
 * The exports below are re-exported from their new locations.
 */

// Simple publisher functions - mirror SDK patterns
export { publishContentItem } from './content-item-publisher';
export { publishPage } from './page-publisher';
export { publishContentList } from './content-list-publisher';
export { publishBatch } from './batch-publisher';

// Re-export from consolidated batch-workflows service in core
export {
    batchWorkflow,
    type BatchItemType,
    createBatches
} from '../../core/batch-workflows';

// Re-export workflow module
export {
    workflowOrchestrator,
    parseWorkflowOptions,
    getOperationName
} from '../workflows';

// Re-export all workflow types from central types folder
export {
    WorkflowOperationType,
    BatchWorkflowResult,
    WorkflowOrchestratorResult,
    WorkflowOptions,
    ContentMapping,
    PageMapping,
    MappingReadResult,
    MappingUpdateResult,
    ItemState,
    SourceItemData,
    PublishStatusResult
} from '../../types';

// Re-export mapping utilities from mappers (moved from publishers)
export {
    updateMappingsAfterPublish,
    updateContentMappingsAfterPublish,
    updatePageMappingsAfterPublish
} from '../mappers/mapping-version-updater';

export {
    readMappingsForGuidPair,
    listAvailableMappingPairs,
    getMappingSummary
} from '../mappers/mapping-reader';

// Re-export source publish status checker functions from shared (moved from publishers)
export {
    checkSourcePublishStatus,
    filterPublishedContent,
    filterPublishedPages,
    isPublished
} from '../shared/source-publish-status-checker';