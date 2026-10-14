import { resetState, setState, registerEffectiveTargetModel } from "core/state";
import { preflightReport } from "lib/preflight/preflight-report";

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

// ─── PROD-2542: required-field validation against the effective target model ───

describe("filterContentItemsForProcessing — required field validation (PROD-2542)", () => {
  const promoBanner = {
    referenceName: "PromoBanner",
    fields: [
      { name: "enabled", type: "Boolean", settings: {} },
      { name: "promoTitle", type: "Text", settings: { Required: "True" } },
      { name: "promoSubtitle", type: "Text", settings: { Required: "True" } },
      { name: "promoImage", type: "ImageAttachment", settings: { Required: "True" } },
    ],
  };

  function bannerItem(id: number, fields: Record<string, any>): any {
    return {
      contentID: id,
      properties: { referenceName: `banner-${id}`, definitionName: "PromoBanner", versionID: 1 },
      fields,
    };
  }

  const wouldCreate = {
    content: null,
    shouldCreate: true,
    shouldUpdate: false,
    shouldSkip: false,
    isConflict: false,
  };

  beforeEach(() => {
    preflightReport.reset();
    registerEffectiveTargetModel("PromoBanner", promoBanner);
  });

  it("routes an item missing a required scalar to itemsToFail, never itemsToProcess", async () => {
    mockFind.mockReturnValue(wouldCreate);
    const bad = bannerItem(12942, { enabled: "true" });
    const result = await filterContentItemsForProcessing(makeBaseProps([bad]));

    expect(result.itemsToProcess).toHaveLength(0);
    expect(result.itemsToSkip).toHaveLength(0);
    expect(result.itemsToFail).toHaveLength(1);
    expect(result.itemsToFail[0].item).toBe(bad);
    expect(result.itemsToFail[0].model).toBe("PromoBanner");
    expect(result.itemsToFail[0].missing).toEqual([
      { name: "promoTitle", type: "Text" },
      { name: "promoSubtitle", type: "Text" },
    ]);
    expect(result.itemsToFail[0].error).toBe(
      "Missing required field(s) on model PromoBanner: promoTitle (Text), promoSubtitle (Text) — skipped client-side"
    );
  });

  it("validates updates too", async () => {
    mockFind.mockReturnValue({ ...wouldCreate, shouldCreate: false, shouldUpdate: true });
    const result = await filterContentItemsForProcessing(makeBaseProps([bannerItem(1, { promoTitle: null })]));
    expect(result.itemsToFail).toHaveLength(1);
    expect(result.itemsToProcess).toHaveLength(0);
  });

  it("does not validate items that are skipped as up to date", async () => {
    mockFind.mockReturnValue({ ...wouldCreate, shouldCreate: false, shouldSkip: true });
    const result = await filterContentItemsForProcessing(makeBaseProps([bannerItem(1, {})]));
    expect(result.itemsToFail).toHaveLength(0);
    expect(result.itemsToSkip).toHaveLength(1);
  });

  it("keeps valid items (in order) and logs warnings without blocking", async () => {
    mockFind.mockReturnValue(wouldCreate);
    const logger = { ...makeLogger(), warning: jest.fn() };
    const items = [
      bannerItem(1, { promoTitle: "a", promoSubtitle: "b" }),
      bannerItem(2, { enabled: "true" }),
      bannerItem(3, { PROMOTITLE: "c", promosubtitle: "" }),
      bannerItem(4, { promoTitle: "d", promoSubtitle: "e" }),
    ];
    const result = await filterContentItemsForProcessing(makeBaseProps(items, { logger }));

    expect(result.itemsToProcess.map((i: any) => i.contentID)).toEqual([1, 3, 4]);
    expect(result.itemsToFail.map((f) => f.item.contentID)).toEqual([2]);
    // promoImage (ImageAttachment) missing on every item + the empty promoSubtitle on item 3
    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining("promoSubtitle (Text) is empty"));
    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining("promoImage (ImageAttachment) has no value"));
  });

  it("skips validation when no model can be resolved", async () => {
    mockFind.mockReturnValue(wouldCreate);
    const item = makeContentItem(1); // definitionName "Model" — not registered, no mapping on disk
    const result = await filterContentItemsForProcessing(makeBaseProps([item]));
    expect(result.itemsToProcess).toEqual([item]);
    expect(result.itemsToFail).toHaveLength(0);
  });

  it("returns an empty itemsToFail for empty input", async () => {
    const result = await filterContentItemsForProcessing(makeBaseProps([]));
    expect(result.itemsToFail).toEqual([]);
  });

  it("records an invalid (not create) preflight entry with the reason", async () => {
    setState({ preflight: true });
    registerEffectiveTargetModel("PromoBanner", promoBanner);
    mockFind.mockReturnValue(wouldCreate);
    await filterContentItemsForProcessing(
      makeBaseProps([bannerItem(1, { enabled: "true" }), bannerItem(2, { promoTitle: "a", promoSubtitle: "b" })])
    );

    const entries = preflightReport.getEntries();
    expect(entries).toEqual([
      expect.objectContaining({
        phase: "Content",
        action: "invalid",
        name: "banner-1",
        locale: "en-us",
        detail: expect.stringContaining("would create but Missing required field(s) on model PromoBanner: promoTitle"),
      }),
      expect.objectContaining({ phase: "Content", action: "create", name: "banner-2" }),
    ]);
    const totals = preflightReport.getTotals();
    expect(totals.create).toBe(1);
    expect(totals.invalid).toBe(1);
    // An invalid item is a warning in the plan — it must not set the conflict exit code.
    expect(preflightReport.hasConflicts()).toBe(false);
  });
});
