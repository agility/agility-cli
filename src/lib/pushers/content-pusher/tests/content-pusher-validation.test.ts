import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state, getFailedContent } from "core/state";

// PROD-2542: how pushContent reports items the filter rejected for a missing required field.
// Classification, filtering and batching are mocked so only content-pusher's own bookkeeping runs.

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
import { pushContent } from "../content-pusher";

const mockTypes = getContentItemTypes as jest.Mock;
const mockFilter = filterContentItemsForProcessing as jest.Mock;

let tmpDir: string;
let logger: any;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-cpv-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  state.failedContentRegistry.clear();
  setState({ rootPath: tmpDir, sourceGuid: "src-guid", targetGuid: "tgt-guid" });
  logger = {
    content: { error: jest.fn(), created: jest.fn(), skipped: jest.fn() },
    warning: jest.fn(),
    getGuid: () => "src-guid",
    setGuid: jest.fn(),
  };
  state.loggerRegistry = new Map([["src-guid", logger]]);
  state.cachedApiClient = {} as any;
  mockProcessBatches.mockReset();
  mockProcessBatches.mockResolvedValue({
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    successfulItems: [],
    failedItems: [],
    publishableIds: [],
  });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function item(id: number, referenceName = `ref-${id}`): any {
  return {
    contentID: id,
    properties: { referenceName, definitionName: "PromoBanner", versionID: 1, state: 2 },
    fields: { enabled: "true" },
  };
}

function invalid(contentItem: any): any {
  return {
    item: contentItem,
    error:
      "Missing required field(s) on model PromoBanner: promoTitle (Text), promoSubtitle (Text) — skipped client-side",
    model: "PromoBanner",
    missing: [
      { name: "promoTitle", type: "Text" },
      { name: "promoSubtitle", type: "Text" },
    ],
  };
}

function filterResult(itemsToProcess: any[], itemsToFail: any[]): any {
  return { itemsToProcess, itemsToSkip: [], skippedCount: 0, itemsToFail };
}

describe("pushContent — client-side validation failures (PROD-2542)", () => {
  it("counts them as failures with full detail, in both the linked and normal passes", async () => {
    const linkedBad = item(10, "linked-bad");
    const normalBad = item(12942, "home_promobanner");
    const normalGood = item(2);
    mockTypes.mockReturnValue({
      linkedContentItems: [linkedBad],
      linkedContentLevels: [[linkedBad]],
      normalContentItems: [normalBad, normalGood],
      skippedItems: [],
    });
    mockFilter
      .mockResolvedValueOnce(filterResult([], [invalid(linkedBad)]))
      .mockResolvedValueOnce(filterResult([normalGood], [invalid(normalBad)]));
    // The linked tier is empty after filtering, so only the normal pass reaches the batch processor.
    mockProcessBatches.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      successfulItems: [],
      failedItems: [],
      publishableIds: [],
    });

    const result = await pushContent([linkedBad, normalBad, normalGood], [], "en-us");

    expect(result.status).toBe("error");
    expect(result.failed).toBe(2);
    expect(result.successful).toBe(1);
    expect(result.failureDetails).toEqual([
      expect.objectContaining({ name: "linked-bad", contentID: 10, type: "content", locale: "en-us" }),
      {
        name: "home_promobanner",
        error:
          "Missing required field(s) on model PromoBanner: promoTitle (Text), promoSubtitle (Text) — skipped client-side",
        type: "content",
        contentID: 12942,
        guid: "src-guid",
        locale: "en-us",
        model: "PromoBanner",
        fields: ["promoTitle (Text)", "promoSubtitle (Text)"],
      },
    ]);
    // Console/log line for each, like any other content failure.
    expect(logger.content.error).toHaveBeenCalledTimes(2);
    expect(logger.content.error).toHaveBeenCalledWith(
      normalBad,
      expect.stringContaining("promoTitle (Text)"),
      "en-us",
      "tgt-guid"
    );
    // The invalid items were never handed to the batch processor.
    const batched = mockProcessBatches.mock.calls.flatMap((c) => c[0]);
    expect(batched).toEqual([normalGood]);
  });

  it("registers a failure (locale-scoped) before the next pass runs", async () => {
    const linkedBad = item(10, "linked-bad");
    const parent = item(20, "parent");
    mockTypes.mockReturnValue({ linkedContentItems: [linkedBad], linkedContentLevels: [[linkedBad]], normalContentItems: [parent], skippedItems: [] });
    let seenDuringNormalPass: any;
    mockFilter.mockResolvedValueOnce(filterResult([], [invalid(linkedBad)])).mockImplementationOnce(async () => {
      seenDuringNormalPass = getFailedContent(10, "en-us");
      return filterResult([parent], []);
    });

    await pushContent([linkedBad, parent], [], "en-us");

    expect(seenDuringNormalPass).toEqual(
      expect.objectContaining({
        referenceName: "linked-bad",
        error: expect.stringContaining("promoTitle"),
        locale: "en-us",
      })
    );
    expect(getFailedContent(10, "es-us")).toBeUndefined();
  });

  it("in preflight, counts them as skips, registers them, and adds no failures", async () => {
    setState({ preflight: true });
    const bad = item(12942);
    const good = item(2);
    mockTypes.mockReturnValue({ linkedContentItems: [], linkedContentLevels: [], normalContentItems: [bad, good], skippedItems: [] });
    mockFilter.mockResolvedValueOnce(filterResult([good], [invalid(bad)]));

    const result = await pushContent([bad, good], [], "en-us");

    expect(result.status).toBe("success");
    expect(result.failed).toBe(0);
    expect(result.failureDetails).toEqual([]);
    expect(result.successful).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockProcessBatches).not.toHaveBeenCalled();
    expect(logger.content.error).not.toHaveBeenCalled();
    expect(getFailedContent(12942, "en-us")).toBeDefined();
  });
});
