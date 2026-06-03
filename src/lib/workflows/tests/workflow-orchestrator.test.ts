import { resetState } from "core/state";
import { WorkflowOperationType } from "types/workflows";
import { workflowOrchestrator } from "../workflow-orchestrator";
import * as processBatchesModule from "../process-batches";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const defaultOptions = {
  locale: "en-us",
  processContent: true,
  processPages: true,
  operation: WorkflowOperationType.Publish,
};

function makeProcessResult(
  overrides: Partial<processBatchesModule.BatchProcessingResult> = {}
): processBatchesModule.BatchProcessingResult {
  return {
    total: 0,
    processed: 0,
    failed: 0,
    batches: 0,
    processedIds: [],
    logLines: [],
    ...overrides,
  };
}

// ─── workflowOrchestrator ─────────────────────────────────────────────────────

describe("workflowOrchestrator", () => {
  describe("when no items are provided", () => {
    it("returns success=true and zero counts", async () => {
      jest.spyOn(processBatchesModule, "processBatches").mockResolvedValue(makeProcessResult());

      const result = await workflowOrchestrator([], [], defaultOptions);

      expect(result.success).toBe(true);
      expect(result.contentResults.total).toBe(0);
      expect(result.pageResults.total).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('logs a "No items to" message', async () => {
      jest.spyOn(processBatchesModule, "processBatches").mockResolvedValue(makeProcessResult());
      const logSpy = jest.spyOn(console, "log");

      await workflowOrchestrator([], [], defaultOptions);

      const calls = logSpy.mock.calls.map((args) => args[0]);
      const noItemsLogged = calls.some((c) => typeof c === "string" && c.includes("No items"));
      expect(noItemsLogged).toBe(true);
    });
  });

  describe("when items are provided and succeed", () => {
    it("returns success=true with processed counts from batch results", async () => {
      jest
        .spyOn(processBatchesModule, "processBatches")
        .mockResolvedValueOnce(makeProcessResult({ total: 3, processed: 3, processedIds: [1, 2, 3] }))
        .mockResolvedValueOnce(makeProcessResult({ total: 2, processed: 2, processedIds: [10, 11] }));

      const result = await workflowOrchestrator([1, 2, 3], [10, 11], defaultOptions);

      expect(result.success).toBe(true);
      expect(result.contentResults.processed).toBe(3);
      expect(result.pageResults.processed).toBe(2);
    });

    it("returns populated logLines collected from both content and page results", async () => {
      jest
        .spyOn(processBatchesModule, "processBatches")
        .mockResolvedValueOnce(
          makeProcessResult({ total: 1, processed: 1, processedIds: [1], logLines: ["content-log"] })
        )
        .mockResolvedValueOnce(
          makeProcessResult({ total: 1, processed: 1, processedIds: [2], logLines: ["page-log"] })
        );

      const result = await workflowOrchestrator([1], [2], defaultOptions);

      expect(result.logLines).toContain("content-log");
      expect(result.logLines).toContain("page-log");
    });
  });

  describe("when processContent is false", () => {
    it("skips calling processBatches for content", async () => {
      const batchSpy = jest
        .spyOn(processBatchesModule, "processBatches")
        .mockResolvedValue(makeProcessResult({ total: 1, processed: 1, processedIds: [10] }));

      await workflowOrchestrator([1, 2], [10], {
        ...defaultOptions,
        processContent: false,
      });

      // Should only be called once (for pages)
      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(batchSpy).toHaveBeenCalledWith(
        expect.any(Array),
        "pages",
        expect.any(String),
        expect.any(Number),
        expect.any(Array)
      );
    });

    it("returns zero content counts when processContent is false", async () => {
      jest
        .spyOn(processBatchesModule, "processBatches")
        .mockResolvedValue(makeProcessResult({ total: 1, processed: 1, processedIds: [10] }));

      const result = await workflowOrchestrator([1, 2], [10], {
        ...defaultOptions,
        processContent: false,
      });

      expect(result.contentResults.processed).toBe(0);
      expect(result.contentResults.total).toBe(0);
    });
  });

  describe("when processPages is false", () => {
    it("skips calling processBatches for pages", async () => {
      const batchSpy = jest
        .spyOn(processBatchesModule, "processBatches")
        .mockResolvedValue(makeProcessResult({ total: 1, processed: 1, processedIds: [1] }));

      await workflowOrchestrator([1], [10, 11], {
        ...defaultOptions,
        processPages: false,
      });

      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(batchSpy).toHaveBeenCalledWith(
        expect.any(Array),
        "content",
        expect.any(String),
        expect.any(Number),
        expect.any(Array)
      );
    });

    it("returns zero page counts when processPages is false", async () => {
      jest
        .spyOn(processBatchesModule, "processBatches")
        .mockResolvedValue(makeProcessResult({ total: 1, processed: 1, processedIds: [1] }));

      const result = await workflowOrchestrator([1], [10, 11], {
        ...defaultOptions,
        processPages: false,
      });

      expect(result.pageResults.processed).toBe(0);
      expect(result.pageResults.total).toBe(0);
    });
  });

  describe("when batches partially fail", () => {
    it("returns success=false when errors accumulate", async () => {
      jest
        .spyOn(processBatchesModule, "processBatches")
        .mockImplementation(async (_ids, _type, _locale, _operation, errors) => {
          errors.push("Batch failed");
          return makeProcessResult({ total: 1, processed: 0, failed: 1 });
        });

      const result = await workflowOrchestrator([1], [2], defaultOptions);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("summary logging with nested items", () => {
    it("logs nested item count when processed > total", async () => {
      // API processed more than requested (nested content)
      jest
        .spyOn(processBatchesModule, "processBatches")
        .mockResolvedValueOnce(makeProcessResult({ total: 2, processed: 5, processedIds: [1, 2, 3, 4, 5] }))
        .mockResolvedValueOnce(makeProcessResult());
      const logSpy = jest.spyOn(console, "log");

      await workflowOrchestrator([1, 2], [], defaultOptions);

      const calls = logSpy.mock.calls.map((args) => args[0]);
      const nestedLogged = calls.some((c) => typeof c === "string" && c.includes("nested"));
      expect(nestedLogged).toBe(true);
    });
  });

  describe("error accumulation", () => {
    it("collects errors from both content and page batch processing", async () => {
      jest
        .spyOn(processBatchesModule, "processBatches")
        .mockImplementation(async (_ids, type, _locale, _operation, errors) => {
          errors.push(`${type} batch error`);
          return makeProcessResult({ total: 1, processed: 0, failed: 1 });
        });

      const result = await workflowOrchestrator([1], [2], defaultOptions);

      expect(result.errors).toContain("content batch error");
      expect(result.errors).toContain("pages batch error");
    });
  });
});
