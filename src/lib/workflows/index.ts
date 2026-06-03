/**
 * Workflows Module
 * 
 * Central exports for all workflow-related functionality.
 */

// Core workflow operation class
export { WorkflowOperation, WorkflowOperationResult } from './workflow-operation';

// Workflow orchestrator
export { workflowOrchestrator } from './workflow-orchestrator';

// Batch processing
export { processBatches, type BatchProcessingResult } from './process-batches';

// Workflow options parsing
export { parseWorkflowOptions, parseOperationType } from './workflow-options';

// Workflow helpers (operation names, verbs, icons)
export { getOperationName, getOperationVerb, getOperationIcon } from './workflow-helpers';

// Mapping utilities
export { listMappings } from './list-mappings';
export { refreshAndUpdateMappings } from './refresh-mappings';
