/**
 * Central exports for all service classes and functions
 * Enables clean single-line imports: import { Auth, Pull, Sync, ... } from './lib/services'
 */

// Core authentication and state management
export { Auth } from './auth';
export { state, setState, resetState, primeFromEnv, getState, getUIMode, configureSSL } from './state';
export { systemArgs, type SystemArgsType } from './system-args';
export { normalizeProcessArgs, normalizeArgv } from './arg-normalizer';

// Main operation services
// export { Sync } from './sync_bak';

// Publishing service
export { PublishService, type PublishResult, type PublishOptions } from './publish';

// Workflow operation standalone module
export { WorkflowOperation } from '../lib/workflows';

// Batch workflows service - core batch operations
export {
    batchWorkflow,
    type BatchItemType,
    createBatches
} from './batch-workflows';

// Workflow module - orchestration, options, helpers
export {
    workflowOrchestrator,
    parseWorkflowOptions,
    parseOperationType,
    getOperationName,
    getOperationVerb,
    getOperationIcon
} from '../lib/workflows';

// Re-export all workflow types from central types folder
export {
    WorkflowOperationType,
    BatchWorkflowResult,
    WorkflowOrchestratorResult,
    WorkflowOptions,
    WorkflowOperationResult,
    ContentMapping,
    PageMapping,
    MappingReadResult,
    MappingUpdateResult,
    ItemState,
    SourceItemData,
    PublishStatusResult
} from '../types';

// Content and data services
export { content } from './content';
export { assets } from './assets';
export { fileOperations } from './fileOperations';
export { getApiClient } from './state';

// File system integration
// Note: store-interface-filesystem uses module.exports, import directly if needed
