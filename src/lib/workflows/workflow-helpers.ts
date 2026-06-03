/**
 * Workflow Helper Functions
 * 
 * Utility functions for workflow operations - operation names, verbs, icons.
 */

import { WorkflowOperationType } from '../../types';

/**
 * Get human-readable operation name
 */
export function getOperationName(operation: WorkflowOperationType): string {
    switch (operation) {
        case WorkflowOperationType.Publish:
            return 'publish';
        case WorkflowOperationType.Unpublish:
            return 'unpublish';
        case WorkflowOperationType.Approve:
            return 'approve';
        case WorkflowOperationType.Decline:
            return 'decline';
        case WorkflowOperationType.RequestApproval:
            return 'request approval';
        default:
            return 'process';
    }
}

/**
 * Get operation verb for logging (past tense)
 */
export function getOperationVerb(operation: WorkflowOperationType): string {
    switch (operation) {
        case WorkflowOperationType.Publish:
            return 'published';
        case WorkflowOperationType.Unpublish:
            return 'unpublished';
        case WorkflowOperationType.Approve:
            return 'approved';
        case WorkflowOperationType.Decline:
            return 'declined';
        case WorkflowOperationType.RequestApproval:
            return 'submitted for approval';
        default:
            return 'processed';
    }
}

/**
 * Get operation icon for logging
 */
export function getOperationIcon(operation: WorkflowOperationType): string {
    switch (operation) {
        case WorkflowOperationType.Publish:
            return '📤';
        case WorkflowOperationType.Unpublish:
            return '📥';
        case WorkflowOperationType.Approve:
            return '✅';
        case WorkflowOperationType.Decline:
            return '❌';
        case WorkflowOperationType.RequestApproval:
            return '📝';
        default:
            return '⚙️';
    }
}
