import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, registerFailedContent } from "core/state";
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

// prepareContentPayloads' result shape: source items paired with their payloads (PROD-2542).
function pairs(items: any[]): Array<{ source: any; payload: any }> {
  return items.map((source) => ({ source, payload: { contentID: -1 } }));
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
      prepared: pairs([makeContentItem(1), makeContentItem(2)]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([makeContentItem(1)]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([item1, item2]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([item1, item2]),
      skippedCount: 0,
      failedItems: [],
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

// ─── processBatches — GEO 400 retry (PROD-2729) ──────────────────────────────

describe("ContentBatchProcessor.processBatches — GEO validation 400 (PROD-2729)", () => {
  // @agility/management-sdk wraps the AxiosError in its own Exception (`innerError`).
  function geo400(exceptionMessage: string): any {
    const err: any = new Error("Unable to create contents.");
    err.innerError = { response: { status: 400, data: { statusCode: 400, exceptionMessage } } };
    return err;
  }

  function preparedWithGeo(items: any[]): Array<{ source: any; payload: any }> {
    return items.map((source) => ({
      source,
      payload: {
        contentID: -1,
        fields: source.fields,
        seo: source.seo,
        ...(source.geo !== undefined ? { geo: source.geo } : {}),
      },
    }));
  }

  it("saves the batch again without the GEO of the items the 400 names, and warns for each", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(geo400("items[1].geo.structuredData: is not valid JSON (bad token)."))
      .mockResolvedValueOnce([42]);
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(save) }));
    const item1 = { ...makeContentItem(1), geo: { summary: "Fine." } };
    const item2 = { ...makeContentItem(2), geo: { summary: "Bad JSON-LD here.", structuredData: "{" } };
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: preparedWithGeo([item1, item2]),
      skippedCount: 0,
      failedItems: [],
    });
    mockExtract.mockReturnValue({
      successfulItems: [
        { originalItem: item1, newItem: { itemID: 101 }, newId: 101 },
        { originalItem: item2, newItem: { itemID: 102 }, newId: 102 },
      ],
      failedItems: [],
    });

    const result = await processor.processBatches([item1, item2], makeLogger(), "Test");

    expect(save).toHaveBeenCalledTimes(2);
    const retried = save.mock.calls[1][0];
    expect(retried[0].geo).toEqual({ summary: "Fine." }); // not named: untouched
    expect(retried[1]).not.toHaveProperty("geo"); // deleted, never nulled
    // Polling matches results against the payloads that were actually sent.
    expect(mockPoll.mock.calls[mockPoll.mock.calls.length - 1][3]).toBe(retried);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        name: "ref-2",
        type: "content",
        contentID: 2,
        code: "geoNotCopied",
        error: expect.stringContaining("GEO not copied: invalid structured data"),
      }),
    ]);
  });

  it("strips only the named seo key when the 400 names a GEO seo field", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(geo400("items[0].seo.canonicalUrl: must be an absolute URL."))
      .mockResolvedValueOnce([42]);
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(save) }));
    const item = {
      ...makeContentItem(1),
      seo: { metaDescription: "d", canonicalUrl: "nope" },
      geo: { summary: "Kept." },
    };
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: preparedWithGeo([item]),
      skippedCount: 0,
      failedItems: [],
    });

    const result = await processor.processBatches([item], makeLogger(), "Test");

    const retried = save.mock.calls[1][0][0];
    expect(retried.seo).toEqual({ metaDescription: "d" });
    expect(retried.geo).toEqual({ summary: "Kept." });
    expect(result.warnings).toHaveLength(1);
  });

  it("fails the batch as before when the 400 is not about GEO", async () => {
    const save = jest.fn().mockRejectedValue(geo400("fields.title: is required."));
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(save) }));
    const item = { ...makeContentItem(1), geo: { summary: "x" } };
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: preparedWithGeo([item]),
      skippedCount: 0,
      failedItems: [],
    });

    const result = await processor.processBatches([item], makeLogger(), "Test");

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.failureCount).toBe(1);
    expect(result.warnings).toBeUndefined();
  });

  it("does not retry when no item carries the rejected GEO data", async () => {
    const save = jest.fn().mockRejectedValue(geo400("items[0].geo.schemaType: must be one of WebPage."));
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(save) }));
    const item = makeContentItem(1);
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: preparedWithGeo([item]),
      skippedCount: 0,
      failedItems: [],
    });

    const result = await processor.processBatches([item], makeLogger(), "Test");

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.failureCount).toBe(1);
  });

  it("fails the batch when the retry fails too", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(geo400("items[0].geo.structuredData: is not valid JSON."))
      .mockRejectedValueOnce(new Error("Request failed with status code 500"));
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(save) }));
    const item = { ...makeContentItem(1), geo: { structuredData: "{" } };
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: preparedWithGeo([item]),
      skippedCount: 0,
      failedItems: [],
    });

    const result = await processor.processBatches([item], makeLogger(), "Test");

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.failureCount).toBe(1);
    expect(result.failedItems[0].error).toContain("status code 500");
  });
});

// ─── processBatches — publishableIds filtering ────────────────────────────────

describe("ContentBatchProcessor.processBatches — publishableIds", () => {
  it("only includes state=2 items in publishableIds", async () => {
    const publishedItem = makeContentItem(1, 2); // state=2
    const stagingItem = makeContentItem(2, 1); // state=1

    const processor = new ContentBatchProcessor(makeConfig());

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: pairs([publishedItem, stagingItem]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([stagingItem]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([stagingItem]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs(stagingItems),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([item]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([item]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([]),
      skippedCount: 1,
      failedItems: [],
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
      prepared: pairs([item]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([item]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([item]),
      skippedCount: 0,
      failedItems: [],
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
      prepared: pairs([item]),
      skippedCount: 0,
      failedItems: [],
    });

    mockExtract.mockReturnValue({
      successfulItems: [{ originalItem: item, newItem: { itemID: 600, processedItemVersionID: 1 }, newId: 600 }],
      failedItems: [],
    });

    await processor.processBatches([item], logger, "Test");
    expect(logger.content.created).toHaveBeenCalledTimes(1);
  });
});

// ─── prepareContentPayloads — stale container mapping (PROD-2309 follow-up) ──
//
// The mapping row can outlive the target container it points to (e.g. the container was
// deleted/soft-deleted on the target since the last successful mapping). Exercises the real
// ModelMapper/ContainerMapper file-based lookups (not mocked) so the guard is proven against
// the actual mapping-file shapes these classes read/write.

function writeMappingFile(root: string, sourceGuid: string, targetGuid: string, type: string, rows: any[]): void {
  const dir = path.join(root, "mappings", `${sourceGuid}-${targetGuid}`, type);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mappings.json"), JSON.stringify(rows));
}

function writeEntityFile(root: string, guid: string, folder: string, id: number, data: any): void {
  const dir = path.join(root, guid, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data));
}

describe("ContentBatchProcessor.prepareContentPayloads — stale container mapping", () => {
  function seedModelAndContainerMapping(
    root: string,
    sourceGuid: string,
    targetGuid: string,
    opts: { createTargetContainerFile: boolean }
  ) {
    writeEntityFile(root, sourceGuid, "models", 1, {
      id: 1,
      referenceName: "TestModel",
      fields: [],
    });
    writeMappingFile(root, sourceGuid, targetGuid, "models", [
      {
        sourceGuid,
        targetGuid,
        sourceID: 1,
        targetID: 1,
        sourceReferenceName: "TestModel",
        targetReferenceName: "TestModel",
        sourceLastModifiedDate: "07/01/2026 12:00PM",
        targetLastModifiedDate: "07/01/2026 12:00PM",
      },
    ]);

    writeMappingFile(root, sourceGuid, targetGuid, "containers", [
      {
        sourceGuid,
        targetGuid,
        sourceContentViewID: 10,
        targetContentViewID: 999,
        sourceReferenceName: "ref-1",
        targetReferenceName: "ref-1",
        sourceLastModifiedDate: "07/01/2026 12:00PM",
        targetLastModifiedDate: "07/01/2026 12:00PM",
      },
    ]);

    if (opts.createTargetContainerFile) {
      writeEntityFile(root, targetGuid, "containers", 999, {
        contentViewID: 999,
        referenceName: "ref-1",
      });
    }
    // else: mapping row exists but the target container's cache file is absent —
    // simulates the container having been deleted on the target since the last sync.
  }

  it("fails the item (not a skip) and does not ship a payload when the target container is gone", async () => {
    const sourceGuid = "pcp-stale-src";
    const targetGuid = "pcp-stale-tgt";
    seedModelAndContainerMapping(tmpDir, sourceGuid, targetGuid, { createTargetContainerFile: false });

    const referenceMapper = new ContentItemMapper(sourceGuid, targetGuid, "en-us");
    const processor = new ContentBatchProcessor(makeConfig({ sourceGuid, targetGuid, referenceMapper }));
    const item = makeContentItem(1);
    item.properties.referenceName = "ref-1";
    item.properties.definitionName = "TestModel";

    const consoleErrorSpy = jest.spyOn(console, "error");
    const result = await (processor as any).prepareContentPayloads([item], sourceGuid, targetGuid, makeLogger());

    expect(result.prepared).toHaveLength(0);
    // PROD-2310: this item never reaches the target, so it must count as a failure —
    // not a skip — so it fails the sync exit code.
    expect(result.skippedCount).toBe(0);
    expect(result.failedItems).toHaveLength(1);
    expect(result.failedItems[0].error).toEqual(expect.stringContaining("no longer exists on the target"));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("no longer exists on the target"));
  });

  it("ships the payload normally when the target container still exists", async () => {
    const sourceGuid = "pcp-live-src";
    const targetGuid = "pcp-live-tgt";
    seedModelAndContainerMapping(tmpDir, sourceGuid, targetGuid, { createTargetContainerFile: true });

    const referenceMapper = new ContentItemMapper(sourceGuid, targetGuid, "en-us");
    const processor = new ContentBatchProcessor(makeConfig({ sourceGuid, targetGuid, referenceMapper }));
    const item = makeContentItem(1);
    item.properties.referenceName = "ref-1";
    item.properties.definitionName = "TestModel";

    const result = await (processor as any).prepareContentPayloads([item], sourceGuid, targetGuid, makeLogger());

    expect(result.skippedCount).toBe(0);
    expect(result.prepared).toHaveLength(1);
    expect(result.prepared[0].source).toBe(item);
    expect(result.prepared[0].payload.properties.referenceName).toBe("ref-1");
  });

  // PROD-2729: GEO fields. On save, an omitted property keeps the target's value and null clears
  // it, so the payload must carry `geo` and the GEO seo keys as pulled and never default them.
  describe("GEO fields (PROD-2729)", () => {
    async function prepareOne(sourceGuid: string, targetGuid: string, item: any) {
      seedModelAndContainerMapping(tmpDir, sourceGuid, targetGuid, { createTargetContainerFile: true });
      const referenceMapper = new ContentItemMapper(sourceGuid, targetGuid, "en-us");
      const processor = new ContentBatchProcessor(makeConfig({ sourceGuid, targetGuid, referenceMapper }));
      item.properties.referenceName = "ref-1";
      item.properties.definitionName = "TestModel";
      const result = await (processor as any).prepareContentPayloads([item], sourceGuid, targetGuid, makeLogger());
      expect(result.prepared).toHaveLength(1);
      return result.prepared[0].payload;
    }

    it("passes geo and the GEO seo keys through untouched", async () => {
      const item = makeContentItem(1);
      item.seo = {
        metaDescription: "desc",
        metaKeywords: null,
        metaHTML: null,
        menuVisible: true,
        sitemapVisible: true,
        title: "Independent title",
        canonicalUrl: "https://example.com/a",
        robots: { index: false, follow: true },
        ogImage: "https://cdn.example.com/og.png",
      };
      item.geo = {
        schemaType: "AboutPage",
        summary: "Answer first.",
        structuredData: { "@type": "AboutPage", name: "About" },
        ai: { llmsInclude: "include", crawl: "inherit" },
      };

      const payload = await prepareOne("geo-pass-src", "geo-pass-tgt", item);

      expect(payload.seo).toEqual(item.seo);
      expect(payload.geo).toEqual(item.geo);
    });

    it("defaults only the five existing seo keys when seo is null, and keeps geo", async () => {
      const item = makeContentItem(1);
      item.seo = null;
      item.geo = { schemaType: "FAQPage", summary: "Kept." };

      const payload = await prepareOne("geo-nullseo-src", "geo-nullseo-tgt", item);

      expect(payload.seo).toEqual({
        metaDescription: null,
        metaKeywords: null,
        metaHTML: null,
        menuVisible: null,
        sitemapVisible: null,
      });
      // The GEO seo keys are omitted (keep the target's value), never sent as null (clear it).
      for (const key of ["title", "canonicalUrl", "robots", "ogImage"]) {
        expect(payload.seo).not.toHaveProperty(key);
      }
      expect(payload.geo).toEqual({ schemaType: "FAQPage", summary: "Kept." });
    });

    it("omits geo (rather than sending null) when the pulled item has none", async () => {
      const item = makeContentItem(1);
      const payload = await prepareOne("geo-none-src", "geo-none-tgt", item);
      expect(payload).not.toHaveProperty("geo");
    });
  });
});

// ─── PROD-2542: payload/source alignment ──────────────────────────────────────
//
// These use the REAL extractContentBatchResults (the module is mocked above for the other tests), so
// the pairing between what was sent and what is mapped is exercised end to end through the processor.

const realBatchPolling = jest.requireActual("lib/pushers/batch-polling");

describe("ContentBatchProcessor — alignment (PROD-2542)", () => {
  beforeEach(() => {
    mockExtract.mockImplementation(realBatchPolling.extractContentBatchResults);
  });

  it("maps the right target IDs when item 2 of 4 drops out before the batch", async () => {
    const referenceMapper = makeMapper();
    const addMappingSpy = jest.spyOn(referenceMapper, "addMapping").mockImplementation(() => {});
    const saveFn = jest.fn().mockResolvedValue([77]);
    const processor = new ContentBatchProcessor(makeConfig({ referenceMapper, apiClient: makeApiClient(saveFn) }));
    const [item1, item2, item3, item4] = [1, 2, 3, 4].map((id) => makeContentItem(id));

    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: [item1, item3, item4].map((source) => ({ source, payload: { contentID: -1, tag: source.contentID } })),
      skippedCount: 0,
      failedItems: [{ originalContent: item2, error: "Missing required field(s)" }],
    });
    mockPoll.mockResolvedValue({
      batchID: 77,
      items: [
        { batchItemID: 1, itemID: 101, processedItemVersionID: 1 },
        { batchItemID: 2, itemID: 103, processedItemVersionID: 1 },
        { batchItemID: 3, itemID: 104, processedItemVersionID: 1 },
      ],
    });

    const result = await processor.processBatches([item1, item2, item3, item4], makeLogger(), "Test");

    // Payloads went out in the same order as their sources.
    expect(saveFn.mock.calls[0][0].map((p: any) => p.tag)).toEqual([1, 3, 4]);
    const mapped = addMappingSpy.mock.calls.map(([source, target]: any[]) => [source.contentID, target.contentID]);
    expect(mapped).toEqual([
      [1, 101],
      [3, 103],
      [4, 104],
    ]);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(1);
    expect(result.failedItems[0].originalContent).toBe(item2);
  });

  it("makes no API call when every item in the batch drops out", async () => {
    mockPoll.mockClear();
    const saveFn = jest.fn().mockResolvedValue([1]);
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(saveFn) }));
    const items = [makeContentItem(1), makeContentItem(2)];
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: [],
      skippedCount: 0,
      failedItems: items.map((item) => ({ originalContent: item, error: "prep failed" })),
    });

    const result = await processor.processBatches(items, makeLogger(), "Test");

    expect(saveFn).not.toHaveBeenCalled();
    expect(mockPoll).not.toHaveBeenCalled();
    expect(result.failureCount).toBe(2);
    expect(result.successCount).toBe(0);
  });

  it("fails only the prepared items when the API call throws (no double count of prep failures)", async () => {
    const saveFn = jest.fn().mockRejectedValue(new Error("API down"));
    const processor = new ContentBatchProcessor(makeConfig({ apiClient: makeApiClient(saveFn) }));
    const [item1, item2, item3] = [1, 2, 3].map((id) => makeContentItem(id));
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: pairs([item1, item3]),
      skippedCount: 0,
      failedItems: [{ originalContent: item2, error: "prep failed" }],
    });

    const result = await processor.processBatches([item1, item2, item3], makeLogger(), "Test");

    expect(result.failureCount).toBe(3);
    expect(result.failedItems).toHaveLength(3);
    const byId = new Map(result.failedItems.map((f: any) => [f.originalContent.contentID, f.error]));
    expect(byId.get(2)).toBe("prep failed");
    expect(byId.get(1)).toContain("Batch processing failed");
    expect(byId.get(3)).toContain("Batch processing failed");
  });

  it("does not re-fail items whose results were already counted when post-processing throws", async () => {
    const processor = new ContentBatchProcessor(makeConfig());
    const item = makeContentItem(1);
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: pairs([item]),
      skippedCount: 0,
      failedItems: [],
    });
    mockPoll.mockResolvedValue({ items: [{ batchItemID: 1, itemID: 500, processedItemVersionID: 1 }] });
    const logger = makeLogger();
    logger.content.created.mockImplementation(() => {
      throw new Error("log write failed");
    });

    const result = await processor.processBatches([item], logger, "Test");

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.failedItems).toHaveLength(0);
  });

  it("fails every item (no mappings) when the batch returns a different number of items", async () => {
    const referenceMapper = makeMapper();
    const addMappingSpy = jest.spyOn(referenceMapper, "addMapping").mockImplementation(() => {});
    const processor = new ContentBatchProcessor(makeConfig({ referenceMapper }));
    const items = [makeContentItem(1), makeContentItem(2)];
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: pairs(items),
      skippedCount: 0,
      failedItems: [],
    });
    mockPoll.mockResolvedValue({ batchID: 9, items: [{ batchItemID: 1, itemID: 101 }] });

    const result = await processor.processBatches(items, makeLogger(), "Test");

    expect(addMappingSpy).not.toHaveBeenCalled();
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(2);
    result.failedItems.forEach((f: any) => expect(f.error).toContain("Unverifiable batch result alignment"));
  });

  it("fails an update whose returned itemID differs from the contentID it was sent with", async () => {
    const referenceMapper = makeMapper();
    const addMappingSpy = jest.spyOn(referenceMapper, "addMapping").mockImplementation(() => {});
    const processor = new ContentBatchProcessor(makeConfig({ referenceMapper }));
    const [item1, item2] = [makeContentItem(1), makeContentItem(2)];
    jest.spyOn(processor as any, "prepareContentPayloads").mockResolvedValue({
      prepared: [
        { source: item1, payload: { contentID: 500 }, expectedId: 500 },
        { source: item2, payload: { contentID: 600 }, expectedId: 600 },
      ],
      skippedCount: 0,
      failedItems: [],
    });
    // Returned in swapped order — exactly what positional matching would have mis-mapped.
    mockPoll.mockResolvedValue({
      items: [
        { batchItemID: 1, itemID: 600, processedItemVersionID: 1 },
        { batchItemID: 2, itemID: 500, processedItemVersionID: 1 },
      ],
    });

    const result = await processor.processBatches([item1, item2], makeLogger(), "Test");

    expect(addMappingSpy).not.toHaveBeenCalled();
    expect(result.failureCount).toBe(2);
    expect(result.failedItems[0].error).toContain("sent as ID 500 but the batch returned itemID 600");
  });
});

// ─── PROD-2542: cascade — name the child that was skipped ─────────────────────

describe("ContentBatchProcessor.prepareContentPayloads — unresolved child cascade (PROD-2542)", () => {
  function seed(sourceGuid: string, targetGuid: string): void {
    writeEntityFile(tmpDir, sourceGuid, "models", 1, { id: 1, referenceName: "TestModel", fields: [] });
    writeMappingFile(tmpDir, sourceGuid, targetGuid, "models", [
      {
        sourceGuid,
        targetGuid,
        sourceID: 1,
        targetID: 1,
        sourceReferenceName: "TestModel",
        targetReferenceName: "TestModel",
      },
    ]);
    writeMappingFile(tmpDir, sourceGuid, targetGuid, "containers", [
      {
        sourceGuid,
        targetGuid,
        sourceContentViewID: 10,
        targetContentViewID: 999,
        sourceReferenceName: "ref-1",
        targetReferenceName: "ref-1",
      },
    ]);
    writeEntityFile(tmpDir, targetGuid, "containers", 999, { contentViewID: 999, referenceName: "ref-1" });
  }

  function parentWithChild(childId: number): any {
    const item = makeContentItem(1);
    item.fields = { title: "Parent", banner: { contentid: childId } };
    return item;
  }

  it("appends the child's skip reason, from the same locale only", async () => {
    const sourceGuid = "cascade-src";
    const targetGuid = "cascade-tgt";
    seed(sourceGuid, targetGuid);
    registerFailedContent(
      12942,
      "home_promobanner",
      "Missing required field(s) on model PromoBanner: promoTitle (Text)",
      "en-us"
    );
    registerFailedContent(777, "es-only", "es failure", "es-us");

    const referenceMapper = new ContentItemMapper(sourceGuid, targetGuid, "en-us");
    const processor = new ContentBatchProcessor(makeConfig({ sourceGuid, targetGuid, referenceMapper }));

    const result = await (processor as any).prepareContentPayloads(
      [parentWithChild(12942)],
      sourceGuid,
      targetGuid,
      makeLogger()
    );
    expect(result.prepared).toHaveLength(0);
    expect(result.failedItems[0].error).toContain("Unresolved content reference(s)");
    expect(result.failedItems[0].error).toContain(
      "(child 'home_promobanner' skipped: Missing required field(s) on model PromoBanner: promoTitle (Text))"
    );

    // A failure registered for es-us must not explain an en-us parent's unresolved reference.
    const other = await (processor as any).prepareContentPayloads(
      [parentWithChild(777)],
      sourceGuid,
      targetGuid,
      makeLogger()
    );
    expect(other.failedItems[0].error).toContain("Unresolved content reference(s)");
    expect(other.failedItems[0].error).not.toContain("child 'es-only'");
  });
});
