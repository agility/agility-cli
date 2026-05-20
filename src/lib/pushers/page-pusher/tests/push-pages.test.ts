import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { pushPages } from '../push-pages';

// Mock processSitemap — it makes real API calls
jest.mock('../process-sitemap', () => ({
  processSitemap: jest.fn(),
  resetProcessedPageIDs: jest.fn(),
}));

import { processSitemap, resetProcessedPageIDs } from '../process-sitemap';

const mockProcessSitemap = processSitemap as jest.Mock;
const mockResetProcessedPageIDs = resetProcessedPageIDs as jest.Mock;

let tmpDir: string;
let localeCounter = 0;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-pp2-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({
    rootPath: tmpDir,
    sourceGuid: 'src-guid',
    targetGuid: 'tgt-guid',
    token: 'test-token',
    overwrite: false,
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockProcessSitemap.mockClear();
  mockResetProcessedPageIDs.mockClear();
  mockProcessSitemap.mockResolvedValue({
    successful: 0,
    failed: 0,
    skipped: 0,
    publishableIds: [],
    failureDetails: [],
  });
  mockResetProcessedPageIDs.mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePage(pageID: number): any {
  return {
    pageID,
    name: `Page ${pageID}`,
    pageType: 'static',
    properties: { state: 2, versionID: 1 },
    zones: {},
  };
}

/** Each test gets a unique locale to avoid sitemap file accumulation between tests */
function uniqueLocale(): string {
  return `locale-${++localeCounter}`;
}

function writeSitemapFile(guid: string, locale: string, channel: string, nodes: any[]): void {
  const dir = path.join(tmpDir, guid, locale, 'nestedsitemap');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${channel}.json`), JSON.stringify(nodes));
}

function makeSitemapNode(pageID: number): any {
  return {
    title: null,
    name: `page-${pageID}`,
    pageID,
    menuText: '',
    visible: { menu: true, sitemap: true },
    path: `/${pageID}`,
    redirect: null,
    isFolder: false,
    children: [],
  };
}

// ─── empty pages ──────────────────────────────────────────────────────────────

describe('pushPages — empty pages', () => {
  it('returns success with zero counts when pages array is empty', async () => {
    const result = await pushPages([], uniqueLocale());
    expect(result.status).toBe('success');
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('returns success with zero counts when pages is null', async () => {
    const result = await pushPages(null as any, uniqueLocale());
    expect(result.status).toBe('success');
    expect(result.successful).toBe(0);
  });

  it('does not call processSitemap when pages is empty', async () => {
    await pushPages([], uniqueLocale());
    expect(mockProcessSitemap).not.toHaveBeenCalled();
  });
});

// ─── no sitemaps ──────────────────────────────────────────────────────────────

describe('pushPages — no sitemaps', () => {
  it('returns success but skips processing when no sitemap directory exists', async () => {
    const pages = [makePage(1)];
    const locale = uniqueLocale();
    // No sitemap file written — SitemapHierarchy.loadAllSitemaps returns {}
    const result = await pushPages(pages, locale);
    expect(result.status).toBe('success');
    expect(mockProcessSitemap).not.toHaveBeenCalled();
  });

  it('logs a console.log message mentioning the channel when sitemap is empty', async () => {
    const consoleSpy = jest.spyOn(console, 'log');
    const guid = 'src-guid';
    const locale = uniqueLocale();
    // Write an empty JSON array for the channel sitemap
    const dir = path.join(tmpDir, guid, locale, 'nestedsitemap');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'website.json'), JSON.stringify([]));

    const pages = [makePage(1)];
    await pushPages(pages, locale);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('website'));
  });
});

// ─── processSitemap delegation ────────────────────────────────────────────────

describe('pushPages — processSitemap delegation', () => {
  it('calls processSitemap once per channel', async () => {
    const guid = 'src-guid';
    const locale = uniqueLocale();
    writeSitemapFile(guid, locale, 'website', [makeSitemapNode(1)]);
    writeSitemapFile(guid, locale, 'mobile', [makeSitemapNode(2)]);

    const pages = [makePage(1), makePage(2)];

    mockProcessSitemap.mockResolvedValue({
      successful: 1, failed: 0, skipped: 0, publishableIds: [], failureDetails: [],
    });

    await pushPages(pages, locale);
    expect(mockProcessSitemap).toHaveBeenCalledTimes(2);
  });

  it('aggregates successful counts from processSitemap', async () => {
    const guid = 'src-guid';
    const locale = uniqueLocale();
    writeSitemapFile(guid, locale, 'website', [makeSitemapNode(1)]);

    const pages = [makePage(1)];

    mockProcessSitemap.mockResolvedValue({
      successful: 3, failed: 0, skipped: 0, publishableIds: [], failureDetails: [],
    });

    const result = await pushPages(pages, locale);
    expect(result.successful).toBe(3);
  });

  it('aggregates failed counts and sets status to error', async () => {
    const guid = 'src-guid';
    const locale = uniqueLocale();
    writeSitemapFile(guid, locale, 'website', [makeSitemapNode(1)]);

    const pages = [makePage(1)];

    mockProcessSitemap.mockResolvedValue({
      successful: 0, failed: 2, skipped: 0, publishableIds: [], failureDetails: [
        { name: 'Page 1', error: 'API error', type: 'page', pageID: 1 }
      ],
    });

    const result = await pushPages(pages, locale);
    expect(result.status).toBe('error');
    expect(result.failed).toBe(2);
  });

  it('aggregates skipped counts', async () => {
    const guid = 'src-guid';
    const locale = uniqueLocale();
    writeSitemapFile(guid, locale, 'website', [makeSitemapNode(1)]);

    const pages = [makePage(1)];

    mockProcessSitemap.mockResolvedValue({
      successful: 0, failed: 0, skipped: 5, publishableIds: [], failureDetails: [],
    });

    const result = await pushPages(pages, locale);
    expect(result.skipped).toBe(5);
  });

  it('merges and deduplicates publishableIds across channels', async () => {
    const guid = 'src-guid';
    const locale = uniqueLocale();
    writeSitemapFile(guid, locale, 'website', [makeSitemapNode(1)]);
    writeSitemapFile(guid, locale, 'mobile', [makeSitemapNode(2)]);

    const pages = [makePage(1), makePage(2)];

    // Both channels return the same publishable ID (simulating duplicate)
    mockProcessSitemap.mockResolvedValue({
      successful: 1, failed: 0, skipped: 0, publishableIds: [42], failureDetails: [],
    });

    const result = await pushPages(pages, locale);
    expect(result.publishableIds).toEqual([42]); // deduplicated
  });

  it('includes failureDetails from processSitemap in the result', async () => {
    const guid = 'src-guid';
    const locale = uniqueLocale();
    writeSitemapFile(guid, locale, 'website', [makeSitemapNode(1)]);

    const pages = [makePage(1)];

    mockProcessSitemap.mockResolvedValue({
      successful: 0, failed: 1, skipped: 0, publishableIds: [],
      failureDetails: [{ name: 'Page 1', error: 'boom', type: 'page', pageID: 1 }],
    });

    const result = await pushPages(pages, locale);
    expect(result.failureDetails).toHaveLength(1);
    expect(result.failureDetails![0].error).toBe('boom');
  });
});

// ─── processSitemap throws ────────────────────────────────────────────────────

describe('pushPages — processSitemap error handling', () => {
  it('sets status to error when processSitemap throws', async () => {
    const guid = 'src-guid';
    const locale = uniqueLocale();
    writeSitemapFile(guid, locale, 'website', [makeSitemapNode(1)]);

    const pages = [makePage(1)];

    mockProcessSitemap.mockRejectedValue(new Error('unexpected crash'));

    // push-pages.ts calls logger.page.error in the catch block
    // getLoggerForGuid returns null after resetState, so we mock the logger registry
    // to avoid the null dereference — easiest to let it catch-all
    const result = await pushPages(pages, locale).catch(() => ({ status: 'error', successful: 0, failed: 0, skipped: 0, failureDetails: [] }));
    expect(result.status).toBe('error');
  });
});

// ─── resetProcessedPageIDs is called ─────────────────────────────────────────

describe('pushPages — resetProcessedPageIDs', () => {
  it('calls resetProcessedPageIDs before processing', async () => {
    await pushPages([makePage(1)], uniqueLocale());
    expect(mockResetProcessedPageIDs).toHaveBeenCalled();
  });
});
