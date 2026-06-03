import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { ContentBatchProcessor } from "../content-batch-processor";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";

// Hoist mocks for modules that make real network calls or file I/O inside processBatches
jest.mock("lib/pushers/batch-polling", () => ({
  pollBatchUntilComplete: jest.fn(),
  extractContentBatchResults: jest.fn(),
}));

jest.mock("../util/find-content-in-other-locale", () => ({
  findContentInOtherLocale: jest.fn().mockResolvedValue(-1),
}));

import { pollBatchUntilComplete, extractContentBatchResults } from "lib/pushers/batch-polling";

const mockPoll = pollBatchUntilComplete as jest.Mock;
const mockExtract = extractContentBatchResults as jest.Mock;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-cbp-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockPoll.mockResolvedValue({});
  mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

let instanceCounter = 0;

function makeMapper(locale = "en-us"): ContentItemMapper {
  instanceCounter++;
  return new ContentItemMapper(`src-${instanceCounter}`, `tgt-${instanceCounter}`, locale);
}

function makeApiClient(saveImpl?: jest.Mock): any {
  return {
    contentMethods: {
      saveContentItems: saveImpl ?? jest.fn().mockResolvedValue([42]),
    },
  };
}

function makeConfig(overrides: Record<string, any> = {}): any {
  return {
    apiClient: makeApiClient(),
    targetGuid: "target-guid",
    sourceGuid: "source-guid",
    locale: "en-us",
    referenceMapper: makeMapper(),
    batchSize: 100,
    useContentFieldMapper: true,
    defaultAssetUrl: "",
    ...overrides,
  };
}

function makeContentItem(id: number, stateVal = 2): any {
  return {
    contentID: id,
    properties: {
      referenceName: `ref-${id}`,
      definitionName: "TestModel",
      versionID: 1,
      state: stateVal,
      itemOrder: id,
    },
    fields: { title: `Item ${id}` },
    seo: null,
    scripts: null,
  };
}

function makeLogger(): any {
  return {
    content: {
      created: jest.fn(),
      error: jest.fn(),
      skipped: jest.fn(),
    },
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe("ContentBatchProcessor constructor", () => {
  it("constructs without throwing given a valid config", () => {
    expect(() => new ContentBatchProcessor(makeConfig())).not.toThrow();
  });

  it("applies default batchSize of 250 when batchSize is omitted", () => {
    const processor = new ContentBatchProcessor(makeConfig({ batchSize: undefined }));
    expect((processor as any).config.batchSize).toBe(250);
  });

  it("preserves an explicit batchSize", () => {
    const processor = new ContentBatchProcessor(makeConfig({ batchSize: 50 }));
    expect((processor as any).config.batchSize).toBe(50);
  });
});

// ─── processBatches — empty input ─────────────────────────────────────────────

describe("ContentBatchProcessor.processBatches — empty input", () => {
  it("returns zero counts for all fields", async () => {
    const processor = new ContentBatchProcessor(makeConfig());
    const result = await processor.processBatches([], makeLogger(), "Test");

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.successfulItems).toHaveLength(0);
    expect(result.failedItems).toHaveLength(0);
    expect(result.publishableIds).toHaveLength(0);
  });

  it("logs a message mentioning 0 content items in 0 batches", async () => {
    const consoleSpy = jest.spyOn(console, "log");
    const processor = new ContentBatchProcessor(makeConfig());
    await processor.processBatches([], makeLogger(), "Test");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("0 content items in 0 bulk"));
  });

  it("does not call saveContentItems when given an empty array", async () => {
    const saveFn = jest.fn().mockResolvedValue([99]);
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(saveFn) }));
    await processor.processBatches([], makeLogger(), "Test");
    expect(saveFn).not.toHaveBeenCalled();
  });
});

// ─── processBatches — batch-level failure ─────────────────────────────────────

describe("ContentBatchProcessor.processBatches — batch-level API failure", () => {
  it("records all items in the failing batch as failed", async () => {
    const saveFn = jest.fn().mockRejectedValue(new Error("API down"));
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(saveFn) }));

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}, {}],
      skippedCount: 0,
      includedItems: [makeContentItem(1), makeContentItem(2)],
    });

    const result = await processor.processBatches([makeContentItem(1), makeContentItem(2)], makeLogger(), "Test");

    expect(result.failureCount).toBe(2);
    expect(result.successCount).toBe(0);
    expect(result.failedItems).toHaveLength(2);
    result.failedItems.forEach((fi: any) => {
      expect(fi.error).toContain("Batch processing failed");
    });
  });

  it("logs an error message when a batch fails", async () => {
    const consoleSpy = jest.spyOn(console, "error");
    const saveFn = jest.fn().mockRejectedValue(new Error("timeout"));
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(saveFn) }));

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [makeContentItem(1)],
    });

    await processor.processBatches([makeContentItem(1)], makeLogger(), "Test");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Bulk batch"), expect.stringContaining("timeout"));
  });
});

// ─── processBatches — successful batch ────────────────────────────────────────

describe("ContentBatchProcessor.processBatches — successful batch", () => {
  it("counts successful items correctly", async () => {
    const processor = new ContentBatchProcessor(makeConfig());
    const item1 = makeContentItem(1);
    const item2 = makeContentItem(2);

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}, {}],
      skippedCount: 0,
      includedItems: [item1, item2],
    });

    mockExtract.mockReturnValue({
      successfulItems: [
        { originalItem: item1, newItem: { itemID: 101, processedItemVersionID: 1 }, newId: 101 },
        { originalItem: item2, newItem: { itemID: 102, processedItemVersionID: 1 }, newId: 102 },
      ],
      failedItems: [],
    });

    const result = await processor.processBatches([item1, item2], makeLogger(), "Test");

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(result.successfulItems).toHaveLength(2);
  });

  it("mixes success and failure item counts across a batch", async () => {
    const processor = new ContentBatchProcessor(makeConfig());
    const item1 = makeContentItem(1);
    const item2 = makeContentItem(2);

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}, {}],
      skippedCount: 0,
      includedItems: [item1, item2],
    });

    mockExtract.mockReturnValue({
      successfulItems: [{ originalItem: item1, newItem: { itemID: 101, processedItemVersionID: 1 }, newId: 101 }],
      failedItems: [{ originalItem: item2, error: "validation error" }],
    });

    const result = await processor.processBatches([item1, item2], makeLogger(), "Test");

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
  });
});

// ─── processBatches — publishableIds filtering ────────────────────────────────

describe("ContentBatchProcessor.processBatches — publishableIds", () => {
  it("only includes state=2 items in publishableIds", async () => {
    const publishedItem = makeContentItem(1, 2); // state=2
    const stagingItem = makeContentItem(2, 1); // state=1

    const processor = new ContentBatchProcessor(makeConfig());

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}, {}],
      skippedCount: 0,
      includedItems: [publishedItem, stagingItem],
    });

    mockExtract.mockReturnValue({
      successfulItems: [
        { originalItem: publishedItem, newItem: { itemID: 101, processedItemVersionID: 1 }, newId: 101 },
        { originalItem: stagingItem, newItem: { itemID: 102, processedItemVersionID: 1 }, newId: 102 },
      ],
      failedItems: [],
    });

    const result = await processor.processBatches([publishedItem, stagingItem], makeLogger(), "Test");

    expect(result.publishableIds).toContain(101);
    expect(result.publishableIds).not.toContain(102);
  });

  it("logs a message about skipping staging items when auto-publish flag on", async () => {
    setState({ rootPath: tmpDir, autoPublish: "content" });
    const consoleSpy = jest.spyOn(console, "log");
    const stagingItem = makeContentItem(1, 1);

    const processor = new ContentBatchProcessor(makeConfig());

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [stagingItem],
    });

    mockExtract.mockReturnValue({
      successfulItems: [{ originalItem: stagingItem, newItem: { itemID: 99, processedItemVersionID: 1 }, newId: 99 }],
      failedItems: [],
    });

    await processor.processBatches([stagingItem], makeLogger(), "Test");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Skipping auto-publish"));
  });

  it("does not log Skipping auto-publish when auto-publish flag is off", async () => {
    const consoleSpy = jest.spyOn(console, "log");
    const stagingItem = makeContentItem(1, 1);

    const processor = new ContentBatchProcessor(makeConfig());

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [stagingItem],
    });

    mockExtract.mockReturnValue({
      successfulItems: [{ originalItem: stagingItem, newItem: { itemID: 99, processedItemVersionID: 1 }, newId: 99 }],
      failedItems: [],
    });

    await processor.processBatches([stagingItem], makeLogger(), "Test");

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("Skipping auto-publish"));
  });

  it("returns empty publishableIds when all items are staging", async () => {
    const stagingItems = [makeContentItem(1, 1), makeContentItem(2, 1)];
    const processor = new ContentBatchProcessor(makeConfig());

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}, {}],
      skippedCount: 0,
      includedItems: stagingItems,
    });

    mockExtract.mockReturnValue({
      successfulItems: stagingItems.map((item, i) => ({
        originalItem: item,
        newItem: { itemID: 100 + i, processedItemVersionID: 1 },
        newId: 100 + i,
      })),
      failedItems: [],
    });

    const result = await processor.processBatches(stagingItems, makeLogger(), "Test");
    expect(result.publishableIds).toHaveLength(0);
  });
});

// ─── processBatches — onBatchComplete callback ────────────────────────────────

describe("ContentBatchProcessor.processBatches — onBatchComplete", () => {
  it("calls onBatchComplete once for a single batch", async () => {
    const onBatchComplete = jest.fn().mockResolvedValue(undefined);
    const processor = new ContentBatchProcessor(makeConfig({ onBatchComplete }));
    const item = makeContentItem(1);

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [item],
    });

    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    await processor.processBatches([item], makeLogger(), "Test");
    expect(onBatchComplete).toHaveBeenCalledTimes(1);
    expect(onBatchComplete).toHaveBeenCalledWith(expect.any(Object), 1);
  });

  it("does not throw when onBatchComplete itself throws", async () => {
    const onBatchComplete = jest.fn().mockRejectedValue(new Error("callback error"));
    const processor = new ContentBatchProcessor(makeConfig({ onBatchComplete }));
    const item = makeContentItem(1);

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [item],
    });

    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    await expect(processor.processBatches([item], makeLogger(), "Test")).resolves.toBeDefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("callback error"));
  });
});

// ─── processBatches — batch splitting ────────────────────────────────────────

describe("ContentBatchProcessor.processBatches — batch splitting", () => {
  it("calls prepareContentPayloads once per batch", async () => {
    const processor = new ContentBatchProcessor(makeConfig({ batchSize: 2 }));

    const prepSpy = jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [],
      skippedCount: 0,
      includedItems: [],
    });

    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    const items = [1, 2, 3, 4, 5].map((id) => makeContentItem(id));
    await processor.processBatches(items, makeLogger(), "Test");

    // 5 items with batchSize=2 → ceil(5/2) = 3 batches
    expect(prepSpy).toHaveBeenCalledTimes(3);
  });

  it("accumulates skippedCount across multiple batches", async () => {
    const processor = new ContentBatchProcessor(makeConfig({ batchSize: 2 }));

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [],
      skippedCount: 1, // 1 skip per batch
      includedItems: [],
    });

    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    const items = [1, 2, 3].map((id) => makeContentItem(id));
    const result = await processor.processBatches(items, makeLogger(), "Test");

    // 3 items with batchSize=2 → 2 batches → 2 skips
    expect(result.skippedCount).toBe(2);
  });
});

// ─── processBatches — ID mapping updates ──────────────────────────────────────

describe("ContentBatchProcessor — referenceMapper.addMapping side effect", () => {
  it("calls addMapping for each successful item", async () => {
    const referenceMapper = makeMapper();
    const addMappingSpy = jest.spyOn(referenceMapper, "addMapping").mockImplementation(() => {});

    const processor = new ContentBatchProcessor(makeConfig({ referenceMapper }));
    const item = makeContentItem(10);

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [item],
    });

    mockExtract.mockReturnValue({
      successfulItems: [{ originalItem: item, newItem: { itemID: 200, processedItemVersionID: 3 }, newId: 200 }],
      failedItems: [],
    });

    await processor.processBatches([item], makeLogger(), "Test");
    expect(addMappingSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call addMapping when there are no successful items", async () => {
    const referenceMapper = makeMapper();
    const addMappingSpy = jest.spyOn(referenceMapper, "addMapping").mockImplementation(() => {});

    const processor = new ContentBatchProcessor(makeConfig({ referenceMapper }));
    const item = makeContentItem(10);

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [item],
    });

    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    await processor.processBatches([item], makeLogger(), "Test");
    expect(addMappingSpy).not.toHaveBeenCalled();
  });
});

// ─── processBatches — failed items logging ────────────────────────────────────

describe("ContentBatchProcessor.processBatches — failed item logging", () => {
  it("calls logger.content.error for each failed item returned from extractBatchResults", async () => {
    const logger = makeLogger();
    const item = makeContentItem(5);

    const processor = new ContentBatchProcessor(makeConfig());

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [item],
    });

    mockExtract.mockReturnValue({
      successfulItems: [],
      failedItems: [{ originalItem: item, error: "field error" }],
    });

    await processor.processBatches([item], logger, "Test");
    expect(logger.content.error).toHaveBeenCalledTimes(1);
  });

  it("calls logger.content.created for each successful item", async () => {
    const logger = makeLogger();
    const item = makeContentItem(6);

    const processor = new ContentBatchProcessor(makeConfig());

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      payloads: [{}],
      skippedCount: 0,
      includedItems: [item],
    });

    mockExtract.mockReturnValue({
      successfulItems: [{ originalItem: item, newItem: { itemID: 600, processedItemVersionID: 1 }, newId: 600 }],
      failedItems: [],
    });

    await processor.processBatches([item], logger, "Test");
    expect(logger.content.created).toHaveBeenCalledTimes(1);
  });
});
