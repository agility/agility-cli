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
import { pushContent, splitIntoLevels, stubCycleReferences } from "../content-pusher";
import { ContentBatchProcessor } from "../content-batch-processor";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";

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
      linkedContentLevels: [[category], [post]], linkedCycleReferences: new Map(),
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
      linkedContentLevels: [[leaf], [mid]], linkedCycleReferences: new Map(),
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
      linkedContentLevels: [[leaf], [mid]], linkedCycleReferences: new Map(),
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
      linkedContentLevels: [[leaf], [mid]], linkedCycleReferences: new Map(),
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

// ─── reference cycles: two passes in the same run (PROD-3076) ────────────────

describe("pushContent — reference cycles (PROD-3076)", () => {
  // A and B reference each other through a single-item linked field
  function cycle(): { a: any; b: any } {
    const a = item(1);
    const b = item(2);
    a.fields = { next: { contentid: 2, fulllist: false } };
    b.fields = { next: { contentid: 1, fulllist: false } };
    return { a, b };
  }

  function classify(a: any, b: any): void {
    mockTypes.mockReturnValue({
      linkedContentItems: [a, b],
      linkedContentLevels: [[a, b]],
      linkedCycleReferences: new Map([
        [1, [2]],
        [2, [1]],
      ]),
      normalContentItems: [],
      skippedItems: [],
    });
    mockFilter.mockResolvedValueOnce(filterResult([a, b]));
  }

  // Every item sent succeeds; target ID = source ID + 1000
  function succeedAll(failIds: number[] = []): void {
    mockProcessBatches.mockImplementation(async (items: any[]) => {
      const ok = items.filter((i) => !failIds.includes(i.contentID));
      const bad = items.filter((i) => failIds.includes(i.contentID));
      return {
        successCount: ok.length,
        failureCount: bad.length,
        skippedCount: 0,
        successfulItems: ok.map((i) => ({ originalContent: i, newItem: {}, newContentId: i.contentID + 1000 })),
        failedItems: bad.map((i) => ({ originalContent: i, error: "boom" })),
        publishableIds: ok.map((i) => i.contentID + 1000),
      };
    });
  }

  it("creates the members with the cycle references blanked, then sends them in full", async () => {
    const { a, b } = cycle();
    classify(a, b);
    succeedAll();

    await pushContent([a, b], [], "en-us");

    const [pass1, pass2] = mockProcessBatches.mock.calls;
    expect(pass1[0].map((i: any) => i.fields.next.contentid)).toEqual([-1, -1]);
    expect(pass1[2]).toBe("Linked Content");
    expect(pass2[0]).toEqual([a, b]);
    expect(pass2[2]).toBe("Linked Content: completing reference cycles");
    // Pass 2 runs through a processor that updates the targets pass 1 just created
    const configs = (ContentBatchProcessor as unknown as jest.Mock).mock.calls.map((c) => c[0]);
    expect(configs.some((c) => c.trustSameRunMappings === true)).toBe(true);
    // The source items themselves are never modified
    expect(a.fields.next.contentid).toBe(2);
  });

  it("counts and publishes each member once", async () => {
    const { a, b } = cycle();
    classify(a, b);
    succeedAll();

    const result = await pushContent([a, b], [], "en-us");

    expect(result.successful).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.publishableIds).toEqual([1001, 1002]);
  });

  it("reports a failed second pass and makes the next sync push the item again", async () => {
    const { a, b } = cycle();
    classify(a, b);
    let call = 0;
    mockProcessBatches.mockImplementation(async (items: any[]) => {
      call++;
      const fail = call === 2 ? [2] : [];
      const ok = items.filter((i) => !fail.includes(i.contentID));
      return {
        successCount: ok.length,
        failureCount: items.length - ok.length,
        skippedCount: 0,
        successfulItems: ok.map((i) => ({ originalContent: i, newItem: {}, newContentId: i.contentID + 1000 })),
        failedItems: items.filter((i) => fail.includes(i.contentID)).map((i) => ({ originalContent: i, error: "boom" })),
        publishableIds: ok.map((i) => i.contentID + 1000),
      };
    });
    const markSpy = jest.spyOn(ContentItemMapper.prototype, "markSourceChanged");

    const result = await pushContent([a, b], [], "en-us");

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    // The half-saved stub of B is not published
    expect(result.publishableIds).toEqual([1001]);
    expect(markSpy).toHaveBeenCalledWith(2);
  });

  it("does not run a second pass for a member whose stub failed", async () => {
    const { a, b } = cycle();
    classify(a, b);
    succeedAll([2]);

    const result = await pushContent([a, b], [], "en-us");

    expect(mockProcessBatches.mock.calls[1][0]).toEqual([a]);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("sends a cycle whose members are already mapped (a re-sync) once, unchanged", async () => {
    const { a, b } = cycle();
    classify(a, b);
    succeedAll();
    jest.spyOn(ContentItemMapper.prototype, "getContentItemMappingByContentID").mockReturnValue({} as any);

    await pushContent([a, b], [], "en-us");

    expect(mockProcessBatches).toHaveBeenCalledTimes(1);
    expect(mockProcessBatches.mock.calls[0][0]).toEqual([a, b]);
  });
});

describe("stubCycleReferences (PROD-3076)", () => {
  const mapper = (mapped: number[]): any => ({
    getContentItemMappingByContentID: (id: number) => (mapped.includes(id) ? {} : null),
  });
  const modelMapper: any = { getModelMappingByReferenceName: () => null, getMappedEntity: () => null };

  it("blanks only the references to unmapped members", () => {
    const a = item(1);
    a.fields = { next: { contentid: 2 }, other: { contentid: 3 }, picks: { sortids: "2,3" } };
    const { toPush, stubbed } = stubCycleReferences([a], new Map([[1, [2, 3]]]), mapper([3]), modelMapper);

    expect(toPush[0].fields).toEqual({ next: { contentid: -1 }, other: { contentid: 3 }, picks: { sortids: "3" } });
    expect(stubbed).toEqual([a]);
  });

  it("passes items outside a cycle through untouched", () => {
    const a = item(1);
    a.fields = { next: { contentid: 2 } };
    const { toPush, stubbed } = stubCycleReferences([a], new Map(), mapper([]), modelMapper);

    expect(toPush).toEqual([a]);
    expect(toPush[0]).toBe(a);
    expect(stubbed).toEqual([]);
  });

  it("stubs a self-reference", () => {
    const c = item(3);
    c.fields = { next: { contentid: 3 } };
    const { toPush, stubbed } = stubCycleReferences([c], new Map([[3, [3]]]), mapper([]), modelMapper);

    expect(toPush[0].fields.next.contentid).toBe(-1);
    expect(stubbed).toEqual([c]);
  });
});
