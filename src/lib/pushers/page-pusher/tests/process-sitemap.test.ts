import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { processSitemap, resetProcessedPageIDs } from "../process-sitemap";
import { SitemapNode } from "types/syncAnalysis";

// Mock processPage — it makes real API calls
jest.mock("../process-page", () => ({
  processPage: jest.fn(),
}));

import { processPage } from "../process-page";

const mockProcessPage = processPage as jest.Mock;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-pstm-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: "src", targetGuid: "tgt" });
  resetProcessedPageIDs();
  mockProcessPage.mockClear();
  mockProcessPage.mockResolvedValue({ status: "success" });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeNode(pageID: number, children: SitemapNode[] = []): SitemapNode {
  return {
    title: null,
    name: `page-${pageID}`,
    pageID,
    menuText: "",
    visible: { menu: true, sitemap: true },
    path: `/${pageID}`,
    redirect: null,
    isFolder: false,
    children,
  };
}

function makePage(pageID: number, state = 2): any {
  return {
    pageID,
    name: `Page ${pageID}`,
    pageType: "static",
    properties: { state, versionID: 1 },
    zones: {},
  };
}

function makePageMapper(): any {
  return {
    getPageMappingByPageID: jest.fn().mockReturnValue({ targetPageID: 999 }),
    getPageMapping: jest.fn().mockReturnValue(null),
    getMappedEntity: jest.fn().mockReturnValue(null),
    addMapping: jest.fn(),
    hasSourceChanged: jest.fn().mockReturnValue(false),
    hasTargetChanged: jest.fn().mockReturnValue(null),
  };
}

function makeApiClient(): any {
  return {
    pageMethods: {
      getSitemap: jest.fn().mockResolvedValue([]),
      savePage: jest.fn().mockResolvedValue([1]),
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
    pageMapper: makePageMapper(),
    sitemapNodes: [],
    sourceGuid: "src",
    targetGuid: "tgt",
    locale: "en-us",
    apiClient: makeApiClient(),
    overwrite: false,
    sourcePages: [],
    parentPageID: -1,
    logger: makeLogger(),
    ...overrides,
  };
}

// ─── empty sitemap ────────────────────────────────────────────────────────────

describe("processSitemap — empty sitemapNodes", () => {
  it("returns zero counts for all result fields", async () => {
    const result = await processSitemap(makeProps({ sitemapNodes: [] }));
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.publishableIds).toHaveLength(0);
    expect(result.failureDetails).toHaveLength(0);
  });

  it("does not call processPage when there are no sitemap nodes", async () => {
    await processSitemap(makeProps({ sitemapNodes: [] }));
    expect(mockProcessPage).not.toHaveBeenCalled();
  });
});

// ─── missing source page ──────────────────────────────────────────────────────

describe("processSitemap — missing source page", () => {
  it("increments failed when a node has no matching source page", async () => {
    const nodes = [makeNode(42)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: [] }));
    expect(result.failed).toBe(1);
    expect(result.failureDetails).toHaveLength(1);
    expect(result.failureDetails[0].name).toContain("42");
  });

  it("logs the error via logger.page.error when source page is missing", async () => {
    const logger = makeLogger();
    const nodes = [makeNode(99)];
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: [], logger }));
    expect(logger.page.error).toHaveBeenCalledTimes(1);
  });
});

// ─── successful processing ────────────────────────────────────────────────────

describe("processSitemap — successful page processing", () => {
  it("increments successful count on processPage success", async () => {
    mockProcessPage.mockResolvedValue({ status: "success" });
    const nodes = [makeNode(1)];
    const pages = [makePage(1, 2)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.successful).toBe(1);
  });

  it("adds pageID to publishableIds when source page state is 2", async () => {
    mockProcessPage.mockResolvedValue({ status: "success" });
    const nodes = [makeNode(1)];
    const pages = [makePage(1, 2)]; // state=2 = published
    const pageMapper = makePageMapper();
    pageMapper.getPageMappingByPageID.mockReturnValue({ targetPageID: 555 });
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages, pageMapper }));
    expect(result.publishableIds).toContain(555);
  });

  it("does NOT add to publishableIds when source page state is not 2", async () => {
    mockProcessPage.mockResolvedValue({ status: "success" });
    const nodes = [makeNode(1)];
    const pages = [makePage(1, 1)]; // state=1 = staging
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.publishableIds).toHaveLength(0);
  });
});

describe("processSitemap — auto-publish skip log", () => {
  it('logs "Skipping auto-publish" for a staging page when state.autoPublish is on', async () => {
    setState({ rootPath: tmpDir, sourceGuid: "src", targetGuid: "tgt", autoPublish: "pages" });
    const consoleSpy = jest.spyOn(console, "log");
    mockProcessPage.mockResolvedValue({ status: "success" });

    const nodes = [makeNode(1)];
    const pages = [makePage(1, 1)];
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Skipping auto-publish"));
  });

  it('does not log "Skipping auto-publish" for a staging page when state.autoPublish is off', async () => {
    const consoleSpy = jest.spyOn(console, "log");
    mockProcessPage.mockResolvedValue({ status: "success" });

    const nodes = [makeNode(1)];
    const pages = [makePage(1, 1)];
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("Skipping auto-publish"));
  });

  it('does not log "Skipping auto-publish" for a published page even when state.autoPublish is on', async () => {
    setState({ rootPath: tmpDir, sourceGuid: "src", targetGuid: "tgt", autoPublish: "pages" });
    const consoleSpy = jest.spyOn(console, "log");
    mockProcessPage.mockResolvedValue({ status: "success" });

    const nodes = [makeNode(1)];
    const pages = [makePage(1, 2)]; // state=2 = published — takes the isSourcePublished branch
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("Skipping auto-publish"));
  });
});

// ─── skipped processing ───────────────────────────────────────────────────────

describe("processSitemap — skipped page processing", () => {
  it("increments skipped count on processPage skip", async () => {
    mockProcessPage.mockResolvedValue({ status: "skip" });
    const nodes = [makeNode(1)];
    const pages = [makePage(1)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
  });
});

// ─── failed processing ────────────────────────────────────────────────────────

describe("processSitemap — failed page processing", () => {
  it("increments failed count on processPage failure", async () => {
    mockProcessPage.mockResolvedValue({ status: "failure", error: "API error" });
    const nodes = [makeNode(1)];
    const pages = [makePage(1)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.failed).toBe(1);
    expect(result.failureDetails).toHaveLength(1);
    expect(result.failureDetails[0].error).toBe("API error");
  });

  it("records page name in failureDetails", async () => {
    mockProcessPage.mockResolvedValue({ status: "failure", error: "boom" });
    const nodes = [makeNode(5)];
    const pages = [makePage(5)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.failureDetails[0].name).toContain("Page 5");
  });
});

// ─── duplicate pageID prevention ──────────────────────────────────────────────

describe("processSitemap — duplicate pageID prevention", () => {
  it("processes a pageID only once even if it appears twice in the sitemap", async () => {
    // Dynamic pages can appear twice (same pageID, different contentID)
    const nodes = [makeNode(7), makeNode(7)];
    const pages = [makePage(7)];
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(1);
  });
});

// ─── recursive children ───────────────────────────────────────────────────────

describe("processSitemap — recursive child processing", () => {
  it("processes child pages of a parent node", async () => {
    const child = makeNode(2);
    const parent = makeNode(1, [child]);
    const pages = [makePage(1), makePage(2)];
    await processSitemap(makeProps({ sitemapNodes: [parent], sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(2);
  });

  it("aggregates counts from children into the parent result", async () => {
    mockProcessPage.mockResolvedValue({ status: "success" });
    const child = makeNode(2);
    const parent = makeNode(1, [child]);
    const pages = [makePage(1, 2), makePage(2, 2)];
    const result = await processSitemap(makeProps({ sitemapNodes: [parent], sourcePages: pages }));
    expect(result.successful).toBe(2);
  });
});

// ─── publishableIds deduplication ─────────────────────────────────────────────

describe("processSitemap — publishableIds deduplication", () => {
  it("deduplicates publishableIds in the returned result", async () => {
    mockProcessPage.mockResolvedValue({ status: "success" });
    // Make getPageMappingByPageID always return the same targetPageID to simulate a duplicate
    const pageMapper = makePageMapper();
    pageMapper.getPageMappingByPageID.mockReturnValue({ targetPageID: 42 });

    const child = makeNode(2);
    const parent = makeNode(1, [child]);
    const pages = [makePage(1, 2), makePage(2, 2)];
    const result = await processSitemap(makeProps({ sitemapNodes: [parent], sourcePages: pages, pageMapper }));

    const uniqueIds = new Set(result.publishableIds);
    expect(result.publishableIds.length).toBe(uniqueIds.size);
  });
});

// ─── resetProcessedPageIDs ────────────────────────────────────────────────────

describe("resetProcessedPageIDs", () => {
  it("allows re-processing of a pageID after reset", async () => {
    mockProcessPage.mockResolvedValue({ status: "success" });
    const nodes = [makeNode(1)];
    const pages = [makePage(1)];

    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(1);

    resetProcessedPageIDs();
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(2);
  });
});

// ─── selective page sync scope (PROD-2546) ────────────────────────────────────

describe("processSitemap — --pages scope", () => {
  /**
   *   /products (3)              ancestor: walked through, never pushed
   *     /my-lottery (10)         selected
   *       /rules (11)            descendant
   *     /other (20)              out of scope
   *   /about (4)                 out of scope
   *     /about/team (5)          out of scope, below an out-of-scope page
   */
  function scopedSitemap(): SitemapNode[] {
    return [
      makeNode(3, [makeNode(10, [makeNode(11)]), makeNode(20)]),
      makeNode(4, [makeNode(5)]),
    ];
  }

  const scope = (overrides: Partial<any> = {}) => ({
    locale: "en-us",
    pageIDs: new Set<number>([10, 11]),
    traversePageIDs: new Set<number>([3]),
    matches: [],
    unmatched: [],
    ancestors: [],
    ...overrides,
  });

  function pushedPageIDs(): number[] {
    return mockProcessPage.mock.calls.map((call) => call[0].page.pageID).sort((a, b) => a - b);
  }

  it("pushes only the selected page and its descendants", async () => {
    const pages = [makePage(10), makePage(11)];
    await processSitemap(makeProps({ sitemapNodes: scopedSitemap(), sourcePages: pages, pageScope: scope() }));
    expect(pushedPageIDs()).toEqual([10, 11]);
  });

  it("does not push the ancestor it walks through to reach the selection", async () => {
    const pages = [makePage(10), makePage(11)];
    await processSitemap(makeProps({ sitemapNodes: scopedSitemap(), sourcePages: pages, pageScope: scope() }));
    expect(pushedPageIDs()).not.toContain(3);
  });

  it("parents the selected page under its ancestor rather than at the sitemap root", async () => {
    const pages = [makePage(10), makePage(11)];
    await processSitemap(makeProps({ sitemapNodes: scopedSitemap(), sourcePages: pages, pageScope: scope() }));
    const lotteryCall = mockProcessPage.mock.calls.find((call) => call[0].page.pageID === 10);
    expect(lotteryCall[0].parentPageID).toBe(3);
  });

  it("does not report out-of-scope pages as missing from source data", async () => {
    // sourcePages holds ONLY the in-scope pages, as the scoped data loader supplies them.
    const pages = [makePage(10), makePage(11)];
    const result = await processSitemap(
      makeProps({ sitemapNodes: scopedSitemap(), sourcePages: pages, pageScope: scope() })
    );
    expect(result.failed).toBe(0);
    expect(result.failureDetails).toHaveLength(0);
  });

  it("does not descend into a branch that contains nothing in scope", async () => {
    const pages = [makePage(10), makePage(11), makePage(5)];
    await processSitemap(makeProps({ sitemapNodes: scopedSitemap(), sourcePages: pages, pageScope: scope() }));
    expect(pushedPageIDs()).not.toContain(5);
  });

  it("still counts an in-scope page that is genuinely missing from source data as a failure", async () => {
    const result = await processSitemap(
      makeProps({ sitemapNodes: scopedSitemap(), sourcePages: [makePage(10)], pageScope: scope() })
    );
    expect(result.failed).toBe(1);
    expect(result.failureDetails[0].pageID).toBe(11);
  });

  it("uses a skipped sibling as the placement anchor for a new page", async () => {
    // Reverse order means node 20 is visited first and becomes the anchor for node 10.
    const nodes = [makeNode(10), makeNode(20)];
    await processSitemap(
      makeProps({
        sitemapNodes: nodes,
        sourcePages: [makePage(10)],
        pageScope: scope({ pageIDs: new Set<number>([10]), traversePageIDs: new Set<number>() }),
      })
    );
    const lotteryCall = mockProcessPage.mock.calls.find((call) => call[0].page.pageID === 10);
    expect(lotteryCall[0].insertBeforePageId).toBe(20);
  });

  it("rolls the counts from an in-scope subtree up through its ancestors", async () => {
    mockProcessPage.mockResolvedValue({ status: "success" });
    const pages = [makePage(10), makePage(11)];
    const result = await processSitemap(
      makeProps({ sitemapNodes: scopedSitemap(), sourcePages: pages, pageScope: scope() })
    );
    expect(result.successful).toBe(2);
  });

  it("pushes every page when no scope is supplied", async () => {
    const pages = [3, 4, 5, 10, 11, 20].map((id) => makePage(id));
    await processSitemap(makeProps({ sitemapNodes: scopedSitemap(), sourcePages: pages }));
    expect(pushedPageIDs()).toEqual([3, 4, 5, 10, 11, 20]);
  });
});
