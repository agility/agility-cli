import { resetState, setState } from 'core/state';
import { WorkflowOperationType } from 'types/workflows';
import { processBatches, BatchProcessingResult } from '../process-batches';
import * as batchWorkflowsModule from '../../../core/batch-workflows';

beforeEach(() => {
    resetState();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

function makeBatchResult(overrides: Partial<Awaited<ReturnType<typeof batchWorkflowsModule.batchWorkflow>>> = {}) {
    return {
        success: true,
        processedIds: [],
        failedCount: 0,
        batchId: 1,
        ...overrides,
    };
}

// ─── processBatches — empty input ────────────────────────────────────────────

describe('processBatches', () => {
    describe('when ids array is empty', () => {
        it('returns a zero-count result immediately without calling batchWorkflow', async () => {
            const batchSpy = jest.spyOn(batchWorkflowsModule, 'batchWorkflow');

            const result = await processBatches([], 'content', 'en-us', WorkflowOperationType.Publish, []);

            expect(result.total).toBe(0);
            expect(result.processed).toBe(0);
            expect(result.failed).toBe(0);
            expect(result.batches).toBe(0);
            expect(result.processedIds).toHaveLength(0);
            expect(batchSpy).not.toHaveBeenCalled();
        });
    });

    describe('deduplication', () => {
        it('removes duplicate IDs before processing', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(makeBatchResult({ processedIds: [1, 2] }));

            const errors: string[] = [];
            const result = await processBatches([1, 2, 1, 2], 'content', 'en-us', WorkflowOperationType.Publish, errors);

            expect(result.total).toBe(2);
        });

        it('logs deduplication message when duplicates are removed', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(makeBatchResult({ processedIds: [1] }));
            const logSpy = jest.spyOn(console, 'log');

            const errors: string[] = [];
            await processBatches([1, 1, 1], 'content', 'en-us', WorkflowOperationType.Publish, errors);

            const calls = logSpy.mock.calls.map(args => args[0]);
            const dedupeLogged = calls.some(c => typeof c === 'string' && c.includes('Deduplicated'));
            expect(dedupeLogged).toBe(true);
        });
    });

    describe('successful batch', () => {
        it('accumulates processedIds and increments processed count', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(
                makeBatchResult({ processedIds: [10, 20, 30] })
            );

            const errors: string[] = [];
            const result = await processBatches([10, 20, 30], 'content', 'en-us', WorkflowOperationType.Publish, errors);

            expect(result.processed).toBe(3);
            expect(result.processedIds).toEqual(expect.arrayContaining([10, 20, 30]));
            expect(result.failed).toBe(0);
            expect(errors).toHaveLength(0);
        });

        it('returns populated logLines', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(
                makeBatchResult({ processedIds: [5] })
            );

            const result = await processBatches([5], 'content', 'en-us', WorkflowOperationType.Publish, []);

            expect(result.logLines.length).toBeGreaterThan(0);
        });
    });

    describe('failed batch', () => {
        it('increments failed count and pushes to errors array on batch failure', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(
                makeBatchResult({ success: false, error: 'API timeout', processedIds: [] })
            );

            const errors: string[] = [];
            const result = await processBatches([1, 2], 'content', 'en-us', WorkflowOperationType.Publish, errors);

            expect(result.failed).toBe(2);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain('API timeout');
        });

        it('increments failed count and pushes to errors array on thrown exception', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockRejectedValue(new Error('Network error'));

            const errors: string[] = [];
            const result = await processBatches([1], 'content', 'en-us', WorkflowOperationType.Publish, errors);

            expect(result.failed).toBe(1);
            expect(errors[0]).toContain('Network error');
        });
    });

    describe('partial success', () => {
        it('tracks partial success: increments failed for the failure portion', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(
                makeBatchResult({
                    success: true,
                    processedIds: [1, 2],
                    partialSuccess: { successCount: 2, failureCount: 1, batchId: 99 },
                })
            );

            const errors: string[] = [];
            const result = await processBatches([1, 2, 3], 'content', 'en-us', WorkflowOperationType.Publish, errors);

            expect(result.failed).toBe(1);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain('Completed with errors');
        });
    });

    describe('batch type labeling', () => {
        it('uses "Content" label for content type', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(
                makeBatchResult({ success: false, error: 'err', processedIds: [] })
            );

            const errors: string[] = [];
            await processBatches([1], 'content', 'en-us', WorkflowOperationType.Publish, errors);

            expect(errors[0]).toMatch(/^Content/);
        });

        it('uses "Page" label for pages type', async () => {
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(
                makeBatchResult({ success: false, error: 'err', processedIds: [] })
            );

            const errors: string[] = [];
            await processBatches([1], 'pages', 'en-us', WorkflowOperationType.Publish, errors);

            expect(errors[0]).toMatch(/^Page/);
        });
    });

    describe('result shape', () => {
        it('returns the correct batches count', async () => {
            jest.spyOn(batchWorkflowsModule, 'createBatches').mockReturnValue([[1, 2], [3, 4], [5]]);
            jest.spyOn(batchWorkflowsModule, 'batchWorkflow').mockResolvedValue(
                makeBatchResult({ processedIds: [1, 2] })
            );

            const result = await processBatches([1, 2, 3, 4, 5], 'content', 'en-us', WorkflowOperationType.Publish, []);

            expect(result.batches).toBe(3);
        });
    });
});
