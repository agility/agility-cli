import { resetState, setState } from "core/state";

// Mock findContentInTargetInstance so we can control its return value
jest.mock("../find-content-in-target-instance", () => ({
  findContentInTargetInstance: jest.fn(),
}));

import { filterContentItemsForProcessing } from "../filter-content-items-for-processing";
import { findContentInTargetInstance } from "../find-content-in-target-instance";

const mockFind = findContentInTargetInstance as jest.Mock;

beforeEach(() => {
  resetState();
  mockFind.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeContentItem(id: number, referenceName = `ref-${id}`): any {
  return {
    contentID: id,
    properties: { referenceName, definitionName: "Model", versionID: 1 },
    fields: {},
  };
}

function makeLogger(): any {
  return {
    content: {
      skipped: jest.fn(),
      error: jest.fn(),
    },
  };
}

function makeBaseProps(contentItems: any[], overrides: Partial<any> = {}): any {
  return {
    contentItems,
    apiClient: {} as any,
    targetGuid: "tgt-guid",
    locale: "en-us",
    referenceMapper: {} as any,
    targetData: [],
    logger: makeLogger(),
    ...overrides,
  };
}

// ─── empty input ──────────────────────────────────────────────────────────────

describe("filterContentItemsForProcessing — empty input", () => {
  it("returns empty arrays when contentItems is empty", async () => {
    const result = await filterContentItemsForProcessing(makeBaseProps([]));
    expect(result.itemsToProcess).toHaveLength(0);
    expect(result.itemsToSkip).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });
});

// ─── shouldCreate → itemsToProcess ───────────────────────────────────────────

describe("filterContentItemsForProcessing — shouldCreate", () => {
  it("includes item in itemsToProcess when shouldCreate is true", async () => {
    const item = makeContentItem(1);
    mockFind.mockReturnValue({
      content: null,
      shouldCreate: true,
      shouldUpdate: false,
      shouldSkip: false,
      isConflict: false,
    });
    const result = await filterContentItemsForProcessing(makeBaseProps([item]));
    expect(result.itemsToProcess).toContain(item);
    expect(result.itemsToSkip).toHaveLength(0);
  });
});

// ─── shouldUpdate → itemsToProcess ───────────────────────────────────────────

describe("filterContentItemsForProcessing — shouldUpdate", () => {
  it("includes item in itemsToProcess when shouldUpdate is true", async () => {
    const item = makeContentItem(1);
    mockFind.mockReturnValue({
      content: item,
      shouldCreate: false,
      shouldUpdate: true,
      shouldSkip: false,
      isConflict: false,
    });
    const result = await filterContentItemsForProcessing(makeBaseProps([item]));
    expect(result.itemsToProcess).toContain(item);
    expect(result.itemsToSkip).toHaveLength(0);
  });
});

// ─── shouldSkip → itemsToSkip ─────────────────────────────────────────────────

describe("filterContentItemsForProcessing — shouldSkip", () => {
  it("puts item in itemsToSkip when shouldSkip is true", async () => {
    const item = makeContentItem(1);
    const logger = makeLogger();
    mockFind.mockReturnValue({
      content: item,
      shouldCreate: false,
      shouldUpdate: false,
      shouldSkip: true,
      isConflict: false,
    });
    const result = await filterContentItemsForProcessing(makeBaseProps([item], { logger }));
    expect(result.itemsToSkip).toContain(item);
    expect(result.itemsToProcess).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
    expect(logger.content.skipped).toHaveBeenCalled();
  });

  it("logs the correct locale and targetGuid when skipping", async () => {
    const item = makeContentItem(1);
    const logger = makeLogger();
    mockFind.mockReturnValue({
      content: item,
      shouldCreate: false,
      shouldUpdate: false,
      shouldSkip: true,
      isConflict: false,
    });
    await filterContentItemsForProcessing(makeBaseProps([item], { logger, locale: "fr-ca", targetGuid: "my-guid" }));
    expect(logger.content.skipped).toHaveBeenCalledWith(item, expect.any(String), "fr-ca", "my-guid");
  });
});

// ─── isConflict → itemsToSkip + warning ───────────────────────────────────────

describe("filterContentItemsForProcessing — isConflict", () => {
  it("puts conflicted item in itemsToSkip", async () => {
    const item = makeContentItem(1);
    mockFind.mockReturnValue({
      content: item,
      shouldCreate: false,
      shouldUpdate: false,
      shouldSkip: false,
      isConflict: true,
      reason: "Both versions changed",
    });
    const result = await filterContentItemsForProcessing(makeBaseProps([item]));
    expect(result.itemsToSkip).toContain(item);
    expect(result.itemsToProcess).toHaveLength(0);
  });

  it("logs a warning when conflict is detected", async () => {
    const item = makeContentItem(1);
    mockFind.mockReturnValue({
      content: null,
      shouldCreate: false,
      shouldUpdate: false,
      shouldSkip: false,
      isConflict: true,
      reason: "conflict reason",
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    await filterContentItemsForProcessing(makeBaseProps([item]));
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe("filterContentItemsForProcessing — error handling", () => {
  it("includes item in itemsToProcess and logs error when findContentInTargetInstance throws", async () => {
    const item = makeContentItem(1);
    const logger = makeLogger();
    mockFind.mockImplementation(() => {
      throw new Error("lookup failed");
    });
    const result = await filterContentItemsForProcessing(makeBaseProps([item], { logger }));
    expect(result.itemsToProcess).toContain(item);
    expect(result.itemsToSkip).toHaveLength(0);
    expect(logger.content.error).toHaveBeenCalledWith(item, "lookup failed", expect.any(String), expect.any(String));
  });
});

// ─── mixed batch ──────────────────────────────────────────────────────────────

describe("filterContentItemsForProcessing — mixed batch", () => {
  it("correctly partitions a batch with create, update, skip, and conflict", async () => {
    const createItem = makeContentItem(1);
    const updateItem = makeContentItem(2);
    const skipItem = makeContentItem(3);
    const conflictItem = makeContentItem(4);

    mockFind
      .mockReturnValueOnce({
        content: null,
        shouldCreate: true,
        shouldUpdate: false,
        shouldSkip: false,
        isConflict: false,
      })
      .mockReturnValueOnce({
        content: updateItem,
        shouldCreate: false,
        shouldUpdate: true,
        shouldSkip: false,
        isConflict: false,
      })
      .mockReturnValueOnce({
        content: skipItem,
        shouldCreate: false,
        shouldUpdate: false,
        shouldSkip: true,
        isConflict: false,
      })
      .mockReturnValueOnce({
        content: conflictItem,
        shouldCreate: false,
        shouldUpdate: false,
        shouldSkip: false,
        isConflict: true,
        reason: "conflict",
      });

    const logger = makeLogger();
    const result = await filterContentItemsForProcessing(
      makeBaseProps([createItem, updateItem, skipItem, conflictItem], { logger })
    );

    expect(result.itemsToProcess).toHaveLength(2);
    expect(result.itemsToProcess).toContain(createItem);
    expect(result.itemsToProcess).toContain(updateItem);
    expect(result.itemsToSkip).toHaveLength(2);
    expect(result.itemsToSkip).toContain(skipItem);
    expect(result.itemsToSkip).toContain(conflictItem);
    expect(result.skippedCount).toBe(2);
  });
});

// ─── skippedCount accuracy ────────────────────────────────────────────────────

describe("filterContentItemsForProcessing — skippedCount", () => {
  it("skippedCount equals itemsToSkip.length", async () => {
    const items = [makeContentItem(1), makeContentItem(2), makeContentItem(3)];
    mockFind.mockReturnValue({
      content: null,
      shouldCreate: false,
      shouldUpdate: false,
      shouldSkip: true,
      isConflict: false,
    });
    const logger = makeLogger();
    const result = await filterContentItemsForProcessing(makeBaseProps(items, { logger }));
    expect(result.skippedCount).toBe(result.itemsToSkip.length);
    expect(result.skippedCount).toBe(3);
  });
});

// ─── verbose logging ──────────────────────────────────────────────────────────

describe("filterContentItemsForProcessing — verbose logging", () => {
  it("logs summary when verbose=true and contentItems is non-empty", async () => {
    setState({ verbose: true });
    const item = makeContentItem(1);
    mockFind.mockReturnValue({
      content: null,
      shouldCreate: true,
      shouldUpdate: false,
      shouldSkip: false,
      isConflict: false,
    });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await filterContentItemsForProcessing(makeBaseProps([item]));
    expect(logSpy).toHaveBeenCalled();
  });

  it("does not log summary when verbose=false", async () => {
    setState({ verbose: false });
    const item = makeContentItem(1);
    mockFind.mockReturnValue({
      content: null,
      shouldCreate: true,
      shouldUpdate: false,
      shouldSkip: false,
      isConflict: false,
    });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await filterContentItemsForProcessing(makeBaseProps([item]));
    expect(logSpy).not.toHaveBeenCalled();
  });
});
