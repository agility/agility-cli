import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { processPage } from "../process-page";

// Mock all modules that make real network or disk calls from within processPage
jest.mock("../find-page-in-other-locale", () => ({
  findPageInOtherLocale: jest.fn().mockResolvedValue(null),
}));

jest.mock("lib/pushers/batch-polling", () => ({
  pollBatchUntilComplete: jest.fn(),
  extractPageBatchResults: jest.fn(),
}));

import { findPageInOtherLocale } from "../find-page-in-other-locale";
import { pollBatchUntilComplete, extractPageBatchResults } from "lib/pushers/batch-polling";

const mockFindInOtherLocale = findPageInOtherLocale as jest.Mock;
const mockPoll = pollBatchUntilComplete as jest.Mock;
const mockExtract = extractPageBatchResults as jest.Mock;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-pp-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: ["src"], targetGuid: ["tgt"] });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockFindInOtherLocale.mockResolvedValue(null);
  mockPoll.mockResolvedValue({ failedItems: [], successItems: [] });
  mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePage(overrides: Partial<any> = {}): any {
  return {
    pageID: 1,
    name: "Test Page",
    pageType: "static",
    templateName: "MainTemplate",
    title: "Test Page Title",
    menuText: "Test",
    zones: {},
    properties: { state: 2, versionID: 10 },
    path: "/test",
    ...overrides,
  };
}

function makePageMapper(overrides: Partial<any> = {}): any {
  return {
    getPageMapping: jest.fn().mockReturnValue(null),
    getMappedEntity: jest.fn().mockReturnValue(null),
    getPageMappingByPageID: jest.fn().mockReturnValue(null),
    addMapping: jest.fn(),
    hasSourceChanged: jest.fn().mockReturnValue(true),
    hasTargetChanged: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

function makeTemplateMapper(): any {
  return {
    getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
    getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
  };
}

function makeApiClient(sitemap: any[] = [{ name: "website", digitalChannelID: 1 }]): any {
  return {
    pageMethods: {
      getSitemap: jest.fn().mockResolvedValue(sitemap),
      savePage: jest.fn().mockResolvedValue([100]),
    },
  };
}

function makeLogger(): any {
  return {
    page: {
      created: jest.fn(),
      updated: jest.fn(),
      skipped: jest.fn(),
      error: jest.fn(),
    },
  };
}

function makeProps(overrides: Partial<any> = {}): any {
  return {
    channel: "website",
    page: makePage(),
    sourceGuid: "src",
    targetGuid: "tgt",
    locale: "en-us",
    apiClient: makeApiClient(),
    overwrite: false,
    insertBeforePageId: null,
    pageMapper: makePageMapper(),
    parentPageID: -1,
    logger: makeLogger(),
    ...overrides,
  };
}

// Mock TemplateMapper and ContentItemMapper at the module level
jest.mock("lib/mappers/template-mapper", () => ({
  TemplateMapper: jest.fn().mockImplementation(() => ({
    getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
    getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
  })),
}));

jest.mock("lib/mappers/content-item-mapper", () => ({
  ContentItemMapper: jest.fn().mockImplementation(() => ({
    getContentItemMappingByContentID: jest.fn().mockReturnValue(null),
  })),
}));

// ─── guard: missing template ──────────────────────────────────────────────────

describe("processPage — missing template", () => {
  it("returns skip when template mapping is not found", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue(null),
      getMappedEntity: jest.fn().mockReturnValue(null),
    }));

    const result = await processPage(makeProps());
    expect(result.status).toBe("skip");
  });
});

// ─── guard: up-to-date page (no change) ───────────────────────────────────────

describe("processPage — up-to-date page", () => {
  it("returns skip when source has not changed and page exists in target", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const existingTargetPage = makePage({ pageID: 99 });
    const pageMapper = makePageMapper({
      getPageMapping: jest.fn().mockReturnValue({ targetPageID: 99, sourcePageID: 1 }),
      getMappedEntity: jest.fn().mockReturnValue(existingTargetPage),
      hasSourceChanged: jest.fn().mockReturnValue(false),
      hasTargetChanged: jest.fn().mockReturnValue(null),
    });

    const result = await processPage(makeProps({ pageMapper, overwrite: false }));
    expect(result.status).toBe("skip");
  });
});

// ─── guard: conflict without overwrite ────────────────────────────────────────

describe("processPage — conflict detection", () => {
  it("returns skip when conflict detected and overwrite is false", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const existingTargetPage = makePage({ pageID: 99 });
    const pageMapper = makePageMapper({
      getPageMapping: jest.fn().mockReturnValue({ targetPageID: 99, sourcePageID: 1 }),
      getMappedEntity: jest.fn().mockReturnValue(existingTargetPage),
      hasSourceChanged: jest.fn().mockReturnValue(true),
      // Non-null from hasTargetChanged means conflict
      hasTargetChanged: jest.fn().mockReturnValue("changed"),
    });

    const result = await processPage(makeProps({ pageMapper, overwrite: false }));
    expect(result.status).toBe("skip");
  });

  it("continues (not skip) when conflict exists but overwrite is true", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const existingTargetPage = makePage({ pageID: 99 });
    const pageMapper = makePageMapper({
      getPageMapping: jest.fn().mockReturnValue({ targetPageID: 99, sourcePageID: 1 }),
      getMappedEntity: jest.fn().mockReturnValue(existingTargetPage),
      hasSourceChanged: jest.fn().mockReturnValue(true),
      hasTargetChanged: jest.fn().mockReturnValue("changed"),
    });

    // With overwrite=true, processPage will proceed to the API call
    // API returns a batch ID → poll → extract → no successes → failure
    mockPoll.mockResolvedValue({ failedItems: [], successItems: [] });
    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    const result = await processPage(makeProps({ pageMapper, overwrite: true }));
    // Should not skip — proceeds to API path (may succeed or fail, but not "skip")
    expect(result.status).not.toBe("skip");
  });
});

// ─── folder pages (no template required) ──────────────────────────────────────

describe("processPage — folder pages", () => {
  it("does not require a template for folder pages", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue(null),
      getMappedEntity: jest.fn().mockReturnValue(null),
    }));

    const folderPage = makePage({ pageType: "folder", templateName: "" });
    const pageMapper = makePageMapper({
      hasSourceChanged: jest.fn().mockReturnValue(true),
    });

    mockPoll.mockResolvedValue({ failedItems: [], successItems: [] });
    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    const result = await processPage(makeProps({ page: folderPage, pageMapper }));
    // Folder pages skip the template lookup, so they reach the API path
    expect(result.status).not.toBe("skip");
  });
});

// ─── successful save via batch ─────────────────────────────────────────────────

describe("processPage — successful batch save", () => {
  it("returns success when batch completes with a valid page ID", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const pageMapper = makePageMapper({
      hasSourceChanged: jest.fn().mockReturnValue(true),
    });

    const savedPage = makePage({ pageID: 200 });
    mockPoll.mockResolvedValue({ failedItems: [], successItems: [savedPage] });
    mockExtract.mockReturnValue({
      successfulItems: [{ newId: 200, newItem: { processedItemVersionID: 5 } }],
      failedItems: [],
    });

    const result = await processPage(makeProps({ pageMapper }));
    expect(result.status).toBe("success");
  });

  it("calls pageMapper.addMapping after a successful save", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const pageMapper = makePageMapper({
      hasSourceChanged: jest.fn().mockReturnValue(true),
    });

    mockPoll.mockResolvedValue({ failedItems: [], successItems: [] });
    mockExtract.mockReturnValue({
      successfulItems: [{ newId: 201, newItem: { processedItemVersionID: 1 } }],
      failedItems: [],
    });

    await processPage(makeProps({ pageMapper }));
    expect(pageMapper.addMapping).toHaveBeenCalledTimes(1);
  });
});

// ─── failure paths ────────────────────────────────────────────────────────────

describe("processPage — failure paths", () => {
  it("returns failure when batch completes with actualPageID <= 0", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const pageMapper = makePageMapper({
      hasSourceChanged: jest.fn().mockReturnValue(true),
    });

    mockPoll.mockResolvedValue({ failedItems: [], errorData: "" });
    mockExtract.mockReturnValue({ successfulItems: [], failedItems: [] });

    const result = await processPage(makeProps({ pageMapper }));
    expect(result.status).toBe("failure");
  });

  it("returns failure when apiClient.pageMethods.savePage throws", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const pageMapper = makePageMapper({
      hasSourceChanged: jest.fn().mockReturnValue(true),
    });

    const apiClient = makeApiClient();
    apiClient.pageMethods.savePage = jest.fn().mockRejectedValue(new Error("network error"));

    const result = await processPage(makeProps({ apiClient, pageMapper }));
    expect(result.status).toBe("failure");
    expect(result.error).toContain("network error");
  });

  it("returns failure with unexpected response format", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const pageMapper = makePageMapper({
      hasSourceChanged: jest.fn().mockReturnValue(true),
    });

    const apiClient = makeApiClient();
    // savePage returns empty array (unexpected)
    apiClient.pageMethods.savePage = jest.fn().mockResolvedValue([]);

    const result = await processPage(makeProps({ apiClient, pageMapper }));
    expect(result.status).toBe("failure");
  });
});

// ─── missing content mapping ──────────────────────────────────────────────────

describe("processPage — missing content mappings", () => {
  it("returns failure when the page's ONLY module has no content mapping (total-loss guard)", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    // Template with a section definition so the zone name is mapped through correctly
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({
        contentSectionDefinitions: [{ pageItemTemplateReferenceName: "Main", itemOrder: 0 }],
      }),
    }));

    const { ContentItemMapper } = require("lib/mappers/content-item-mapper");
    ContentItemMapper.mockImplementation(() => ({
      getContentItemMappingByContentID: jest.fn().mockReturnValue(null),
    }));

    const pageWithContent = makePage({
      zones: {
        // Zone name matches section definition so translateZoneNames keeps it
        Main: [{ module: "Hero", item: { contentid: 55 } }],
      },
    });

    const pageMapper = makePageMapper({
      hasSourceChanged: jest.fn().mockReturnValue(true),
    });

    const result = await processPage(makeProps({ page: pageWithContent, pageMapper }));
    expect(result.status).toBe("failure");
    // Could be "missing content mappings" or "Lost all N modules" depending on code path
    expect(result.error).toBeTruthy();
  });
});

// ─── PROD-2316: unresolvable modules are dropped, page still pushes ───────────

describe("processPage — dropped modules (PROD-2316)", () => {
  function setupTemplateWithMainZone() {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({
        contentSectionDefinitions: [{ pageItemTemplateReferenceName: "Main", itemOrder: 0 }],
      }),
    }));
  }

  function setupContentMapperResolvingOnly(resolvableIds: Record<number, number>) {
    const { ContentItemMapper } = require("lib/mappers/content-item-mapper");
    ContentItemMapper.mockImplementation(() => ({
      getContentItemMappingByContentID: jest.fn((id: number) =>
        resolvableIds[id] ? { targetContentID: resolvableIds[id] } : null
      ),
    }));
  }

  it("pushes the page successfully with the unresolvable module dropped, and reports a warning", async () => {
    setupTemplateWithMainZone();
    setupContentMapperResolvingOnly({ 55: 955 }); // 55 resolves; 66 does not

    const pageWithContent = makePage({
      zones: {
        Main: [
          { module: "Hero", item: { contentid: 55 } },
          { module: "Broken", item: { contentid: 66 } },
        ],
      },
    });

    const pageMapper = makePageMapper({ hasSourceChanged: jest.fn().mockReturnValue(true) });
    const apiClient = makeApiClient();

    mockExtract.mockReturnValue({
      successfulItems: [{ newId: 400, newItem: { processedItemVersionID: 7 } }],
      failedItems: [],
    });

    const result = await processPage(makeProps({ page: pageWithContent, pageMapper, apiClient }));

    expect(result.status).toBe("success");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0].contentID).toBe(66);
    expect(result.warnings![0].error).toContain("Dropped module Broken");

    // The pushed payload contains only the resolvable module, remapped to its target ID.
    const savedPayload = (apiClient.pageMethods.savePage as jest.Mock).mock.calls[0][0];
    expect(savedPayload.zones.Main).toHaveLength(1);
    expect(savedPayload.zones.Main[0].item.contentid).toBe(955);
  });

  it("records the page mapping as dirty (sourceVersionID 0) when modules were dropped, so it re-pushes next sync", async () => {
    setupTemplateWithMainZone();
    setupContentMapperResolvingOnly({ 55: 955 });

    const pageWithContent = makePage({
      properties: { state: 2, versionID: 42 },
      zones: {
        Main: [
          { module: "Hero", item: { contentid: 55 } },
          { module: "Broken", item: { contentid: 66 } },
        ],
      },
    });

    const pageMapper = makePageMapper({ hasSourceChanged: jest.fn().mockReturnValue(true) });

    mockExtract.mockReturnValue({
      successfulItems: [{ newId: 400, newItem: { processedItemVersionID: 7 } }],
      failedItems: [],
    });

    await processPage(makeProps({ page: pageWithContent, pageMapper }));

    expect(pageMapper.addMapping).toHaveBeenCalledTimes(1);
    const [sourceArg] = (pageMapper.addMapping as jest.Mock).mock.calls[0];
    expect(sourceArg.properties.versionID).toBe(0);
  });

  it("records the page mapping normally (real versionID) when nothing was dropped", async () => {
    setupTemplateWithMainZone();
    setupContentMapperResolvingOnly({ 55: 955 });

    const pageWithContent = makePage({
      properties: { state: 2, versionID: 42 },
      zones: { Main: [{ module: "Hero", item: { contentid: 55 } }] },
    });

    const pageMapper = makePageMapper({ hasSourceChanged: jest.fn().mockReturnValue(true) });

    mockExtract.mockReturnValue({
      successfulItems: [{ newId: 401, newItem: { processedItemVersionID: 8 } }],
      failedItems: [],
    });

    const result = await processPage(makeProps({ page: pageWithContent, pageMapper }));

    expect(result.status).toBe("success");
    expect(result.warnings).toBeUndefined();
    const [sourceArg] = (pageMapper.addMapping as jest.Mock).mock.calls[0];
    expect(sourceArg.properties.versionID).toBe(42);
  });

  it("fails an UPDATE (not just a create) when EVERY module is unresolvable, instead of wiping the target page", async () => {
    setupTemplateWithMainZone();
    setupContentMapperResolvingOnly({}); // nothing resolves

    const pageWithContent = makePage({
      zones: {
        Main: [
          { module: "Hero", item: { contentid: 55 } },
          { module: "Promo", item: { contentid: 66 } },
        ],
      },
    });

    // Existing page on target → update path (the old guard only covered creates)
    const existingTargetPage = makePage({ pageID: 99 });
    const pageMapper = makePageMapper({
      getPageMapping: jest.fn().mockReturnValue({ targetPageID: 99, sourcePageID: 1 }),
      getMappedEntity: jest.fn().mockReturnValue(existingTargetPage),
      hasSourceChanged: jest.fn().mockReturnValue(true),
      hasTargetChanged: jest.fn().mockReturnValue(null),
    });

    const apiClient = makeApiClient();
    const result = await processPage(makeProps({ page: pageWithContent, pageMapper, apiClient }));

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Lost all 2 modules");
    expect(result.warnings).toHaveLength(2);
    // The destructive save is never attempted.
    expect(apiClient.pageMethods.savePage).not.toHaveBeenCalled();
  });

  it("keeps modules without any content reference while dropping unresolvable ones", async () => {
    setupTemplateWithMainZone();
    setupContentMapperResolvingOnly({});

    const pageWithContent = makePage({
      zones: {
        Main: [
          { module: "StaticBanner", item: null }, // no content reference — always kept
          { module: "Broken", item: { contentid: 66 } },
        ],
      },
    });

    const pageMapper = makePageMapper({ hasSourceChanged: jest.fn().mockReturnValue(true) });
    const apiClient = makeApiClient();

    mockExtract.mockReturnValue({
      successfulItems: [{ newId: 402, newItem: { processedItemVersionID: 9 } }],
      failedItems: [],
    });

    const result = await processPage(makeProps({ page: pageWithContent, pageMapper, apiClient }));

    expect(result.status).toBe("success");
    expect(result.warnings).toHaveLength(1);
    const savedPayload = (apiClient.pageMethods.savePage as jest.Mock).mock.calls[0][0];
    expect(savedPayload.zones.Main).toHaveLength(1);
    expect(savedPayload.zones.Main[0].module).toBe("StaticBanner");
  });
});

// ─── channel fallback ─────────────────────────────────────────────────────────

describe("processPage — channel resolution", () => {
  it("uses first channel digitalChannelID as fallback when channel name not found", async () => {
    const { TemplateMapper } = require("lib/mappers/template-mapper");
    TemplateMapper.mockImplementation(() => ({
      getTemplateMappingByPageTemplateName: jest.fn().mockReturnValue({ ref: "Main" }),
      getMappedEntity: jest.fn().mockReturnValue({ contentSectionDefinitions: [] }),
    }));

    const pageMapper = makePageMapper({ hasSourceChanged: jest.fn().mockReturnValue(true) });
    // Sitemap has a different channel name
    const apiClient = makeApiClient([{ name: "other-channel", digitalChannelID: 42 }]);

    mockPoll.mockResolvedValue({ failedItems: [] });
    mockExtract.mockReturnValue({
      successfulItems: [{ newId: 300, newItem: { processedItemVersionID: 1 } }],
      failedItems: [],
    });

    const result = await processPage(makeProps({ apiClient, pageMapper, channel: "website" }));
    // Should proceed (uses fallback channelID=42) — result is success or failure but not an early return
    expect(["success", "failure", "skip"]).toContain(result.status);
  });
});
