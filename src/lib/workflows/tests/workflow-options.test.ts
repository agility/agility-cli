import { resetState } from 'core/state';
import { WorkflowOperationType } from 'types/workflows';
import { parseOperationType, parseWorkflowOptions } from '../workflow-options';

beforeEach(() => {
    resetState();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ─── parseOperationType ───────────────────────────────────────────────────────

describe('parseOperationType', () => {
    it('returns Publish when operationType is undefined', () => {
        expect(parseOperationType(undefined)).toBe(WorkflowOperationType.Publish);
    });

    it.each([
        ['publish', WorkflowOperationType.Publish],
        ['PUBLISH', WorkflowOperationType.Publish],
        ['unpublish', WorkflowOperationType.Unpublish],
        ['UNPUBLISH', WorkflowOperationType.Unpublish],
        ['approve', WorkflowOperationType.Approve],
        ['Approve', WorkflowOperationType.Approve],
        ['decline', WorkflowOperationType.Decline],
        ['requestapproval', WorkflowOperationType.RequestApproval],
        ['request-approval', WorkflowOperationType.RequestApproval],
        ['request_approval', WorkflowOperationType.RequestApproval],
    ])('parses "%s" to the correct enum value', (input, expected) => {
        expect(parseOperationType(input)).toBe(expected);
    });

    it('defaults to Publish for an unrecognized string', () => {
        expect(parseOperationType('unknown-op')).toBe(WorkflowOperationType.Publish);
    });
});

// ─── parseWorkflowOptions ─────────────────────────────────────────────────────

describe('parseWorkflowOptions', () => {
    it('returns null when operationType is falsy', () => {
        expect(parseWorkflowOptions('', 'en-us')).toBeNull();
        expect(parseWorkflowOptions(false, 'en-us')).toBeNull();
    });

    it('returns options with both processContent and processPages true by default', () => {
        const opts = parseWorkflowOptions(true, 'en-us');
        expect(opts).not.toBeNull();
        expect(opts!.processContent).toBe(true);
        expect(opts!.processPages).toBe(true);
        expect(opts!.locale).toBe('en-us');
        expect(opts!.operation).toBe(WorkflowOperationType.Publish);
    });

    it.each([
        ['publish', WorkflowOperationType.Publish, true, true],
        ['unpublish', WorkflowOperationType.Unpublish, true, true],
        ['approve', WorkflowOperationType.Approve, true, true],
        ['decline', WorkflowOperationType.Decline, true, true],
        ['requestapproval', WorkflowOperationType.RequestApproval, true, true],
        ['request-approval', WorkflowOperationType.RequestApproval, true, true],
        ['request_approval', WorkflowOperationType.RequestApproval, true, true],
    ])('parses string "%s" to correct operation with both content and pages', (input, op, content, pages) => {
        const opts = parseWorkflowOptions(input, 'en-us');
        expect(opts).not.toBeNull();
        expect(opts!.operation).toBe(op);
        expect(opts!.processContent).toBe(content);
        expect(opts!.processPages).toBe(pages);
    });

    it('sets processPages=false when operationType is "content"', () => {
        const opts = parseWorkflowOptions('content', 'en-us');
        expect(opts).not.toBeNull();
        expect(opts!.processContent).toBe(true);
        expect(opts!.processPages).toBe(false);
    });

    it('sets processContent=false when operationType is "pages"', () => {
        const opts = parseWorkflowOptions('pages', 'en-us');
        expect(opts).not.toBeNull();
        expect(opts!.processContent).toBe(false);
        expect(opts!.processPages).toBe(true);
    });

    it('accepts a direct WorkflowOperationType enum value', () => {
        const opts = parseWorkflowOptions(WorkflowOperationType.Unpublish, 'fr-fr');
        expect(opts).not.toBeNull();
        expect(opts!.operation).toBe(WorkflowOperationType.Unpublish);
        expect(opts!.locale).toBe('fr-fr');
    });

    it('sets locale from the provided locale argument', () => {
        const opts = parseWorkflowOptions('publish', 'de-de');
        expect(opts!.locale).toBe('de-de');
    });

    it('handles "true" string as default publish-both', () => {
        const opts = parseWorkflowOptions('true', 'en-us');
        expect(opts!.processContent).toBe(true);
        expect(opts!.processPages).toBe(true);
        expect(opts!.operation).toBe(WorkflowOperationType.Publish);
    });

    it('handles unrecognized string by defaulting to publish-both', () => {
        const opts = parseWorkflowOptions('garbage', 'en-us');
        expect(opts!.processContent).toBe(true);
        expect(opts!.processPages).toBe(true);
        expect(opts!.operation).toBe(WorkflowOperationType.Publish);
    });
});
