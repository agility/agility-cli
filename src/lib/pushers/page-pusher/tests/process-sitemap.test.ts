import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { processSitemap, resetProcessedPageIDs } from '../process-sitemap';
import { SitemapNode } from 'types/syncAnalysis';

// Mock processPage — it makes real API calls
jest.mock('../process-page', () => ({
  processPage: jest.fn(),
}));

import { processPage } from '../process-page';

const mockProcessPage = processPage as jest.Mock;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-pstm-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: 'src', targetGuid: 'tgt' });
  resetProcessedPageIDs();
  mockProcessPage.mockClear();
  mockProcessPage.mockResolvedValue({ status: 'success' });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
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
    menuText: '',
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
    pageType: 'static',
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
    channel: 'website',
    pageMapper: makePageMapper(),
    sitemapNodes: [],
    sourceGuid: 'src',
    targetGuid: 'tgt',
    locale: 'en-us',
    apiClient: makeApiClient(),
    overwrite: false,
    sourcePages: [],
    parentPageID: -1,
    logger: makeLogger(),
    ...overrides,
  };
}

// ─── empty sitemap ────────────────────────────────────────────────────────────

describe('processSitemap — empty sitemapNodes', () => {
  it('returns zero counts for all result fields', async () => {
    const result = await processSitemap(makeProps({ sitemapNodes: [] }));
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.publishableIds).toHaveLength(0);
    expect(result.failureDetails).toHaveLength(0);
  });

  it('does not call processPage when there are no sitemap nodes', async () => {
    await processSitemap(makeProps({ sitemapNodes: [] }));
    expect(mockProcessPage).not.toHaveBeenCalled();
  });
});

// ─── missing source page ──────────────────────────────────────────────────────

describe('processSitemap — missing source page', () => {
  it('increments failed when a node has no matching source page', async () => {
    const nodes = [makeNode(42)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: [] }));
    expect(result.failed).toBe(1);
    expect(result.failureDetails).toHaveLength(1);
    expect(result.failureDetails[0].name).toContain('42');
  });

  it('logs the error via logger.page.error when source page is missing', async () => {
    const logger = makeLogger();
    const nodes = [makeNode(99)];
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: [], logger }));
    expect(logger.page.error).toHaveBeenCalledTimes(1);
  });
});

// ─── successful processing ────────────────────────────────────────────────────

describe('processSitemap — successful page processing', () => {
  it('increments successful count on processPage success', async () => {
    mockProcessPage.mockResolvedValue({ status: 'success' });
    const nodes = [makeNode(1)];
    const pages = [makePage(1, 2)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.successful).toBe(1);
  });

  it('adds pageID to publishableIds when source page state is 2', async () => {
    mockProcessPage.mockResolvedValue({ status: 'success' });
    const nodes = [makeNode(1)];
    const pages = [makePage(1, 2)]; // state=2 = published
    const pageMapper = makePageMapper();
    pageMapper.getPageMappingByPageID.mockReturnValue({ targetPageID: 555 });
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages, pageMapper }));
    expect(result.publishableIds).toContain(555);
  });

  it('does NOT add to publishableIds when source page state is not 2', async () => {
    mockProcessPage.mockResolvedValue({ status: 'success' });
    const nodes = [makeNode(1)];
    const pages = [makePage(1, 1)]; // state=1 = staging
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.publishableIds).toHaveLength(0);
  });
});

// ─── skipped processing ───────────────────────────────────────────────────────

describe('processSitemap — skipped page processing', () => {
  it('increments skipped count on processPage skip', async () => {
    mockProcessPage.mockResolvedValue({ status: 'skip' });
    const nodes = [makeNode(1)];
    const pages = [makePage(1)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
  });
});

// ─── failed processing ────────────────────────────────────────────────────────

describe('processSitemap — failed page processing', () => {
  it('increments failed count on processPage failure', async () => {
    mockProcessPage.mockResolvedValue({ status: 'failure', error: 'API error' });
    const nodes = [makeNode(1)];
    const pages = [makePage(1)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.failed).toBe(1);
    expect(result.failureDetails).toHaveLength(1);
    expect(result.failureDetails[0].error).toBe('API error');
  });

  it('records page name in failureDetails', async () => {
    mockProcessPage.mockResolvedValue({ status: 'failure', error: 'boom' });
    const nodes = [makeNode(5)];
    const pages = [makePage(5)];
    const result = await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(result.failureDetails[0].name).toContain('Page 5');
  });
});

// ─── duplicate pageID prevention ──────────────────────────────────────────────

describe('processSitemap — duplicate pageID prevention', () => {
  it('processes a pageID only once even if it appears twice in the sitemap', async () => {
    // Dynamic pages can appear twice (same pageID, different contentID)
    const nodes = [makeNode(7), makeNode(7)];
    const pages = [makePage(7)];
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(1);
  });
});

// ─── recursive children ───────────────────────────────────────────────────────

describe('processSitemap — recursive child processing', () => {
  it('processes child pages of a parent node', async () => {
    const child = makeNode(2);
    const parent = makeNode(1, [child]);
    const pages = [makePage(1), makePage(2)];
    await processSitemap(makeProps({ sitemapNodes: [parent], sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(2);
  });

  it('aggregates counts from children into the parent result', async () => {
    mockProcessPage.mockResolvedValue({ status: 'success' });
    const child = makeNode(2);
    const parent = makeNode(1, [child]);
    const pages = [makePage(1, 2), makePage(2, 2)];
    const result = await processSitemap(makeProps({ sitemapNodes: [parent], sourcePages: pages }));
    expect(result.successful).toBe(2);
  });
});

// ─── publishableIds deduplication ─────────────────────────────────────────────

describe('processSitemap — publishableIds deduplication', () => {
  it('deduplicates publishableIds in the returned result', async () => {
    mockProcessPage.mockResolvedValue({ status: 'success' });
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

describe('resetProcessedPageIDs', () => {
  it('allows re-processing of a pageID after reset', async () => {
    mockProcessPage.mockResolvedValue({ status: 'success' });
    const nodes = [makeNode(1)];
    const pages = [makePage(1)];

    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(1);

    resetProcessedPageIDs();
    await processSitemap(makeProps({ sitemapNodes: nodes, sourcePages: pages }));
    expect(mockProcessPage).toHaveBeenCalledTimes(2);
  });
});
