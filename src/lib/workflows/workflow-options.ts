/**
 * Workflow Options Parsing
 * 
 * Functions for parsing and converting workflow operation options.
 */

import { WorkflowOperationType, WorkflowOptions } from '../../types';

/**
 * Convert string operation type to WorkflowOperationType enum
 */
export function parseOperationType(operationType: string | undefined): WorkflowOperationType {
    if (!operationType) return WorkflowOperationType.Publish;
    
    switch (operationType.toLowerCase()) {
        case 'publish':
            return WorkflowOperationType.Publish;
        case 'unpublish':
            return WorkflowOperationType.Unpublish;
        case 'approve':
            return WorkflowOperationType.Approve;
        case 'decline':
            return WorkflowOperationType.Decline;
        case 'requestapproval':
        case 'request-approval':
        case 'request_approval':
            return WorkflowOperationType.RequestApproval;
        default:
            return WorkflowOperationType.Publish;
    }
}

/**
 * Parse workflow options from state/command args
 */
export function parseWorkflowOptions(
    operationType: string | boolean | WorkflowOperationType,
    locale: string
): WorkflowOptions | null {
    if (!operationType) return null;
    
    // Default operation is Publish
    let operation = WorkflowOperationType.Publish;
    let processContent = true;
    let processPages = true;
    
    // Handle string operation types
    if (typeof operationType === 'string') {
        const value = operationType.toLowerCase();
        
        // Check for operation type
        switch (value) {
            case 'publish':
                operation = WorkflowOperationType.Publish;
                break;
            case 'unpublish':
                operation = WorkflowOperationType.Unpublish;
                break;
            case 'approve':
                operation = WorkflowOperationType.Approve;
                break;
            case 'decline':
                operation = WorkflowOperationType.Decline;
                break;
            case 'requestapproval':
            case 'request-approval':
            case 'request_approval':
                operation = WorkflowOperationType.RequestApproval;
                break;
            case 'content':
                processPages = false;
                break;
            case 'pages':
                processContent = false;
                break;
            case 'true':
                // Default behavior - process both
                break;
            default:
                // Unrecognized value - default to publish both
                break;
        }
    } else if (typeof operationType === 'number') {
        // Direct WorkflowOperationType enum value
        operation = operationType;
    }
    
    return { processContent, processPages, locale, operation };
}
