import { resetState } from 'core/state';
import { WorkflowOperationType } from 'types/workflows';
import { getOperationName, getOperationVerb, getOperationIcon } from '../workflow-helpers';

beforeEach(() => {
    resetState();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ─── getOperationName ─────────────────────────────────────────────────────────

describe('getOperationName', () => {
    it.each([
        [WorkflowOperationType.Publish, 'publish'],
        [WorkflowOperationType.Unpublish, 'unpublish'],
        [WorkflowOperationType.Approve, 'approve'],
        [WorkflowOperationType.Decline, 'decline'],
        [WorkflowOperationType.RequestApproval, 'request approval'],
    ])('returns %s for %i', (operation, expected) => {
        expect(getOperationName(operation)).toBe(expected);
    });

    it('returns "process" for an unrecognized enum value', () => {
        expect(getOperationName(9999 as WorkflowOperationType)).toBe('process');
    });
});

// ─── getOperationVerb ─────────────────────────────────────────────────────────

describe('getOperationVerb', () => {
    it.each([
        [WorkflowOperationType.Publish, 'published'],
        [WorkflowOperationType.Unpublish, 'unpublished'],
        [WorkflowOperationType.Approve, 'approved'],
        [WorkflowOperationType.Decline, 'declined'],
        [WorkflowOperationType.RequestApproval, 'submitted for approval'],
    ])('returns %s for %i', (operation, expected) => {
        expect(getOperationVerb(operation)).toBe(expected);
    });

    it('returns "processed" for an unrecognized enum value', () => {
        expect(getOperationVerb(9999 as WorkflowOperationType)).toBe('processed');
    });
});

// ─── getOperationIcon ─────────────────────────────────────────────────────────

describe('getOperationIcon', () => {
    it('returns a non-empty string for every known operation type', () => {
        const knownTypes = [
            WorkflowOperationType.Publish,
            WorkflowOperationType.Unpublish,
            WorkflowOperationType.Approve,
            WorkflowOperationType.Decline,
            WorkflowOperationType.RequestApproval,
        ];
        for (const op of knownTypes) {
            expect(getOperationIcon(op).length).toBeGreaterThan(0);
        }
    });

    it('returns a non-empty string for an unrecognized enum value', () => {
        expect(getOperationIcon(9999 as WorkflowOperationType).length).toBeGreaterThan(0);
    });

    it('returns different icons for Publish vs Unpublish', () => {
        expect(getOperationIcon(WorkflowOperationType.Publish)).not.toBe(
            getOperationIcon(WorkflowOperationType.Unpublish)
        );
    });
});
