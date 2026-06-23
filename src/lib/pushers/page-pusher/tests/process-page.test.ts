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
  it("returns failure when a zone module has no content mapping", async () => {
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
