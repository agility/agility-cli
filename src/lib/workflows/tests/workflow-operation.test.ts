import { resetState, setState } from "core/state";
import { state } from "core/state";
import { WorkflowOperationType } from "types/workflows";
import { WorkflowOperation } from "../workflow-operation";
import * as mappingReader from "../../mappers/mapping-reader";
import * as workflowOrchestratorModule from "../workflow-orchestrator";
import * as refreshMappingsModule from "../refresh-mappings";
import * as listMappingsModule from "../list-mappings";
import * as sourcePublishStatusChecker from "../../shared/source-publish-status-checker";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeOrchestratorResult(overrides: any = {}) {
  return {
    success: true,
    contentResults: { total: 0, processed: 0, failed: 0, batches: 0, processedIds: [], logLines: [] },
    pageResults: { total: 0, processed: 0, failed: 0, batches: 0, processedIds: [], logLines: [] },
    errors: [],
    logLines: [],
    ...overrides,
  };
}

function makeMappingResult(overrides: any = {}) {
  return {
    contentIds: [],
    pageIds: [],
    contentMappings: [],
    pageMappings: [],
    errors: [],
    ...overrides,
  };
}

function makeMappingSummary(totalContent = 0, totalPages = 0) {
  return { totalContent, totalPages, localesFound: ["en-us"] };
}

// ─── WorkflowOperation.executeFromMappings — guard clauses ───────────────────

describe("WorkflowOperation.executeFromMappings", () => {
  describe("guard clauses", () => {
    it("returns success=false when sourceGuid is missing", async () => {
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];

      const op = new WorkflowOperation();
      const result = await op.executeFromMappings();

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain("Source GUID");
    });

    it("returns success=false when targetGuid is missing", async () => {
      state.sourceGuid = ["src-u"];
      state.locale = ["en-us"];

      const op = new WorkflowOperation();
      const result = await op.executeFromMappings();

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain("Target GUID");
    });

    it("returns success=false when locale is missing", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];

      const op = new WorkflowOperation();
      const result = await op.executeFromMappings();

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain("locale");
    });
  });

  describe("standard mode — no mappings found", () => {
    it("returns early with success=true and zero counts when no mappings exist", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];

      jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue(makeMappingSummary(0, 0));
      jest.spyOn(mappingReader, "readMappingsForGuidPair").mockReturnValue(makeMappingResult());

      const op = new WorkflowOperation();
      const result = await op.executeFromMappings();

      expect(result.success).toBe(true);
      expect(result.contentProcessed).toBe(0);
      expect(result.pagesProcessed).toBe(0);
    });
  });

  describe("publish operation with source status check", () => {
    it("filters content to only published-in-source IDs", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];
      state.operationType = "publish";

      jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue(makeMappingSummary(2, 0));
      jest
        .spyOn(mappingReader, "readMappingsForGuidPair")
        .mockReturnValue(makeMappingResult({ contentIds: [1, 2], pageIds: [] }));
      jest.spyOn(sourcePublishStatusChecker, "checkSourcePublishStatus").mockReturnValue({
        publishedContentIds: [1],
        unpublishedContentIds: [2],
        publishedPageIds: [],
        unpublishedPageIds: [],
        errors: [],
      });
      const orchestratorSpy = jest.spyOn(workflowOrchestratorModule, "workflowOrchestrator").mockResolvedValue(
        makeOrchestratorResult({
          contentResults: { total: 1, processed: 1, failed: 0, batches: 1, processedIds: [1], logLines: [] },
        })
      );
      jest.spyOn(refreshMappingsModule, "refreshAndUpdateMappings").mockResolvedValue(undefined);

      const op = new WorkflowOperation();
      await op.executeFromMappings();

      const callArgs = orchestratorSpy.mock.calls[0];
      expect(callArgs[0]).toEqual([1]); // only published ID
    });
  });

  describe("non-publish operation", () => {
    it("passes all mapped IDs to workflowOrchestrator without source status check", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];
      state.operationType = "unpublish";

      jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue(makeMappingSummary(2, 1));
      jest
        .spyOn(mappingReader, "readMappingsForGuidPair")
        .mockReturnValue(makeMappingResult({ contentIds: [1, 2], pageIds: [10] }));
      const statusCheckSpy = jest.spyOn(sourcePublishStatusChecker, "checkSourcePublishStatus");
      const orchestratorSpy = jest
        .spyOn(workflowOrchestratorModule, "workflowOrchestrator")
        .mockResolvedValue(makeOrchestratorResult());

      const op = new WorkflowOperation();
      await op.executeFromMappings();

      expect(statusCheckSpy).not.toHaveBeenCalled();
      expect(orchestratorSpy).toHaveBeenCalledWith(
        [1, 2],
        [10],
        expect.objectContaining({ operation: WorkflowOperationType.Unpublish })
      );
    });
  });

  describe("explicit IDs mode", () => {
    it("uses explicit contentIDs when provided", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];
      state.operationType = "unpublish";
      state.explicitContentIDs = [100, 200];
      state.explicitPageIDs = [];

      jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue(makeMappingSummary(0, 0));

      const orchestratorSpy = jest
        .spyOn(workflowOrchestratorModule, "workflowOrchestrator")
        .mockResolvedValue(makeOrchestratorResult());

      const op = new WorkflowOperation();
      await op.executeFromMappings();

      expect(orchestratorSpy).toHaveBeenCalledWith([100, 200], [], expect.any(Object));
    });

    it("returns early when all explicit IDs are empty", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];
      state.operationType = "unpublish";
      state.explicitContentIDs = [];
      state.explicitPageIDs = [];

      // Even though summary says 0, we need a getMappingSummary mock since it's called
      jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue(makeMappingSummary(0, 0));

      const orchestratorSpy = jest.spyOn(workflowOrchestratorModule, "workflowOrchestrator");

      const op = new WorkflowOperation();
      const result = await op.executeFromMappings();

      expect(orchestratorSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("result fields", () => {
    it("returns operation name in the result", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];
      state.operationType = "approve";

      jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue(makeMappingSummary(0, 0));

      const op = new WorkflowOperation();
      const result = await op.executeFromMappings();

      expect(result.operation).toBe("approve");
    });

    it("includes elapsedTime in the result", async () => {
      state.sourceGuid = ["src-u"];
      state.targetGuid = ["tgt-u"];
      state.locale = ["en-us"];

      jest.spyOn(mappingReader, "getMappingSummary").mockReturnValue(makeMappingSummary(0, 0));

      const op = new WorkflowOperation();
      const result = await op.executeFromMappings();

      expect(typeof result.elapsedTime).toBe("number");
      expect(result.elapsedTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("listMappings method", () => {
    it("delegates to the listMappings function without throwing", () => {
      jest.spyOn(listMappingsModule, "listMappings").mockImplementation(() => {});

      const op = new WorkflowOperation();
      expect(() => op.listMappings()).not.toThrow();
    });
  });
});
