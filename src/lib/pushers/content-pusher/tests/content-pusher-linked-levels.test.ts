import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, getFailedContent } from "core/state";

// PROD-3025: pushContent pushes the linked tier one dependency level at a time, leaves first.
// Classification, filtering and batching are mocked so only content-pusher's own ordering runs.

jest.mock("../util/get-content-item-types", () => ({
  getContentItemTypes: jest.fn(),
}));

jest.mock("../util/filter-content-items-for-processing", () => ({
  filterContentItemsForProcessing: jest.fn(),
}));

const mockProcessBatches = jest.fn();
jest.mock("../content-batch-processor", () => ({
  ContentBatchProcessor: jest.fn().mockImplementation(() => ({ processBatches: mockProcessBatches })),
}));

import { getContentItemTypes } from "../util/get-content-item-types";
import { filterContentItemsForProcessing } from "../util/filter-content-items-for-processing";
import { pushContent, splitIntoLevels } from "../content-pusher";

const mockTypes = getContentItemTypes as jest.Mock;
const mockFilter = filterContentItemsForProcessing as jest.Mock;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-cpl-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  state.failedContentRegistry.clear();
  setState({ rootPath: tmpDir, sourceGuid: "src-guid", targetGuid: "tgt-guid" });
  const logger = {
    content: { error: jest.fn(), created: jest.fn(), skipped: jest.fn() },
    warning: jest.fn(),
    getGuid: () => "src-guid",
    setGuid: jest.fn(),
  };
  state.loggerRegistry = new Map([["src-guid", logger as any]]);
  state.cachedApiClient = {} as any;
  mockProcessBatches.mockReset();
  mockFilter.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function item(id: number): any {
  return { contentID: id, properties: { referenceName: `ref-${id}`, definitionName: "Model", state: 2 }, fields: {} };
}

function filterResult(itemsToProcess: any[], skippedCount = 0): any {
  return { itemsToProcess, itemsToSkip: [], skippedCount, itemsToFail: [] };
}

function batchResult(items: any[], failed: any[] = []): any {
  return {
    successCount: items.length,
    failureCount: failed.length,
    skippedCount: 0,
    successfulItems: [],
    failedItems: failed.map((f) => ({ originalContent: f, error: "boom" })),
    publishableIds: items.map((i) => i.contentID + 1000),
  };
}

describe("pushContent — linked dependency levels (PROD-3025)", () => {
  it("pushes each level in its own processBatches call, leaves first, then the normal tier", async () => {
    const category = item(1);
    const post = item(2);
    const featured = item(3);
    mockTypes.mockReturnValue({
      linkedContentItems: [post, category],
      linkedContentLevels: [[category], [post]],
      normalContentItems: [featured],
      skippedItems: [],
    });
    // The filter returns the linked tier in arbitrary order; the levels decide the push order
    mockFilter.mockResolvedValueOnce(filterResult([post, category])).mockResolvedValueOnce(filterResult([featured]));
    mockProcessBatches.mockImplementation(async (items: any[]) => batchResult(items));

    const result = await pushContent([featured, post, category], [], "en-us");

    const calls = mockProcessBatches.mock.calls.map((c) => [c[0].map((i: any) => i.contentID), c[2]]);
    expect(calls).toEqual([
      [[1], "Linked Content (level 1/2)"],
      [[2], "Linked Content (level 2/2)"],
      [[3], "Normal Content"],
    ]);
    expect(result.status).toBe("success");
    expect(result.successful).toBe(3);
    expect(result.publishableIds).toEqual([1001, 1002, 1003]);
  });

  it("adds up failures across levels and registers each one", async () => {
    const leaf = item(1);
    const mid = item(2);
    mockTypes.mockReturnValue({
      linkedContentItems: [leaf, mid],
      linkedContentLevels: [[leaf], [mid]],
      normalContentItems: [],
      skippedItems: [],
    });
    mockFilter.mockResolvedValueOnce(filterResult([leaf, mid], 2));
    mockProcessBatches
      .mockResolvedValueOnce(batchResult([leaf]))
      .mockResolvedValueOnce(batchResult([], [mid]));

    const result = await pushContent([leaf, mid], [], "en-us");

    expect(result.status).toBe("error");
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.failureDetails).toEqual([expect.objectContaining({ contentID: 2, error: "boom" })]);
    expect(getFailedContent(2, "en-us")).toBeDefined();
  });

  it("does not call the batch processor for a level the filter emptied", async () => {
    const leaf = item(1);
    const mid = item(2);
    mockTypes.mockReturnValue({
      linkedContentItems: [leaf, mid],
      linkedContentLevels: [[leaf], [mid]],
      normalContentItems: [],
      skippedItems: [],
    });
    // leaf is unchanged on the target, so only mid is left to push
    mockFilter.mockResolvedValueOnce(filterResult([mid], 1));
    mockProcessBatches.mockImplementation(async (items: any[]) => batchResult(items));

    await pushContent([leaf, mid], [], "en-us");

    expect(mockProcessBatches).toHaveBeenCalledTimes(1);
    expect(mockProcessBatches.mock.calls[0][0]).toEqual([mid]);
    expect(mockProcessBatches.mock.calls[0][2]).toBe("Linked Content");
  });

  it("writes nothing in preflight", async () => {
    setState({ preflight: true });
    const leaf = item(1);
    const mid = item(2);
    mockTypes.mockReturnValue({
      linkedContentItems: [leaf, mid],
      linkedContentLevels: [[leaf], [mid]],
      normalContentItems: [],
      skippedItems: [],
    });
    mockFilter.mockResolvedValueOnce(filterResult([leaf, mid]));

    const result = await pushContent([leaf, mid], [], "en-us");

    expect(mockProcessBatches).not.toHaveBeenCalled();
    expect(result.successful).toBe(2);
  });
});

describe("splitIntoLevels", () => {
  it("groups items by level and drops empty levels", () => {
    const a = item(1);
    const b = item(2);
    const c = item(3);
    expect(splitIntoLevels([c, a], [[a], [b], [c]])).toEqual([[a], [c]]);
  });

  it("puts an item missing from every level last", () => {
    const a = item(1);
    const stray = item(9);
    expect(splitIntoLevels([stray, a], [[a]])).toEqual([[a], [stray]]);
  });
});
