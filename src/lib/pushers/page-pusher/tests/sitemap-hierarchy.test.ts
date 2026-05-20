import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { SitemapHierarchy } from '../sitemap-hierarchy';
import { SitemapNode, PageHierarchy } from 'types/syncAnalysis';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-sh-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePage(pageID: number): any {
  return { pageID, name: `page-${pageID}` };
}

function makeNode(pageID: number, children: SitemapNode[] = []): SitemapNode {
  return {
    title: null,
    name: `node-${pageID}`,
    pageID,
    menuText: '',
    visible: { menu: true, sitemap: true },
    path: `/${pageID}`,
    redirect: null,
    isFolder: false,
    children,
  };
}

function writeSitemapFile(dir: string, channel: string, nodes: SitemapNode[]): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${channel}.json`), JSON.stringify(nodes));
}

function sitemapDir(guid: string, locale: string): string {
  return path.join(tmpDir, guid, locale, 'nestedsitemap');
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('SitemapHierarchy constructor', () => {
  it('constructs without throwing', () => {
    expect(() => new SitemapHierarchy()).not.toThrow();
  });
});

// ─── loadNestedSitemap ────────────────────────────────────────────────────────

describe('SitemapHierarchy.loadNestedSitemap', () => {
  it('returns null when file does not exist', () => {
    const sh = new SitemapHierarchy();
    const result = sh.loadNestedSitemap(path.join(tmpDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('returns parsed sitemap nodes when file is valid JSON', () => {
    const filePath = path.join(tmpDir, 'valid.json');
    const nodes = [makeNode(1), makeNode(2)];
    fs.writeFileSync(filePath, JSON.stringify(nodes));
    const sh = new SitemapHierarchy();
    const result = sh.loadNestedSitemap(filePath);
    expect(result).toHaveLength(2);
    expect(result![0].pageID).toBe(1);
  });

  it('returns null when file contains invalid JSON', () => {
    const filePath = path.join(tmpDir, 'invalid.json');
    fs.writeFileSync(filePath, '{not valid json}');
    const sh = new SitemapHierarchy();
    const result = sh.loadNestedSitemap(filePath);
    expect(result).toBeNull();
  });
});

// ─── loadAllSitemaps ──────────────────────────────────────────────────────────

describe('SitemapHierarchy.loadAllSitemaps', () => {
  it('returns empty object when sitemap directory does not exist', () => {
    const sh = new SitemapHierarchy();
    const result = sh.loadAllSitemaps('no-such-guid', 'en-us');
    expect(result).toEqual({});
  });

  it('loads all .json files as channels', () => {
    const guid = 'guid-load-all';
    const locale = 'en-us';
    const dir = sitemapDir(guid, locale);
    writeSitemapFile(dir, 'website', [makeNode(1)]);
    writeSitemapFile(dir, 'mobile', [makeNode(2)]);
    const sh = new SitemapHierarchy();
    const result = sh.loadAllSitemaps(guid, locale);
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['website', 'mobile']));
  });

  it('ignores non-.json files in the sitemap directory', () => {
    const guid = 'guid-non-json';
    const locale = 'en-us';
    const dir = sitemapDir(guid, locale);
    fs.mkdirSync(dir, { recursive: true });
    writeSitemapFile(dir, 'website', [makeNode(1)]);
    fs.writeFileSync(path.join(dir, 'README.txt'), 'ignore me');
    const sh = new SitemapHierarchy();
    const result = sh.loadAllSitemaps(guid, locale);
    expect(Object.keys(result)).toEqual(['website']);
  });
});

// ─── buildPageHierarchy ───────────────────────────────────────────────────────

describe('SitemapHierarchy.buildPageHierarchy', () => {
  it('returns empty object for an empty sitemap', () => {
    const sh = new SitemapHierarchy();
    expect(sh.buildPageHierarchy([])).toEqual({});
  });

  it('does not add leaf nodes (no children) to hierarchy', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(1), makeNode(2)];
    const hierarchy = sh.buildPageHierarchy(sitemap);
    expect(Object.keys(hierarchy)).toHaveLength(0);
  });

  it('maps parent to direct child IDs', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(1, [makeNode(2), makeNode(3)])];
    const hierarchy = sh.buildPageHierarchy(sitemap);
    expect(hierarchy[1]).toEqual([2, 3]);
  });

  it('handles nested hierarchy recursively', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(1, [makeNode(2, [makeNode(3)])])];
    const hierarchy = sh.buildPageHierarchy(sitemap);
    expect(hierarchy[1]).toEqual([2]);
    expect(hierarchy[2]).toEqual([3]);
  });
});

// ─── groupPagesHierarchically ─────────────────────────────────────────────────

describe('SitemapHierarchy.groupPagesHierarchically', () => {
  it('returns each page as its own group when hierarchy is empty', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const groups = sh.groupPagesHierarchically(pages, {});
    expect(groups).toHaveLength(2);
    groups.forEach(g => expect(g.childPages).toHaveLength(0));
  });

  it('groups parent and children together', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2), makePage(3)];
    const hierarchy: PageHierarchy = { 1: [2, 3] };
    const groups = sh.groupPagesHierarchically(pages, hierarchy);
    expect(groups).toHaveLength(1);
    expect(groups[0].rootPage.pageID).toBe(1);
    expect(groups[0].childPages.map((p: any) => p.pageID)).toEqual(expect.arrayContaining([2, 3]));
  });

  it('marks all pages within a group as processed (no duplicates)', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const hierarchy: PageHierarchy = { 1: [2] };
    const groups = sh.groupPagesHierarchically(pages, hierarchy);
    // Total pages across all groups should equal original page count
    const totalIds = groups.flatMap(g => Array.from(g.allPageIds));
    expect(new Set(totalIds).size).toBe(pages.length);
  });
});

// ─── calculatePageDepths ──────────────────────────────────────────────────────

describe('SitemapHierarchy.calculatePageDepths', () => {
  it('assigns depth 0 to all pages when hierarchy is empty', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const depths = sh.calculatePageDepths(pages, {});
    expect(depths.get(1)).toBe(0);
    expect(depths.get(2)).toBe(0);
  });

  it('assigns depth 1 to direct children', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const hierarchy: PageHierarchy = { 1: [2] };
    const depths = sh.calculatePageDepths(pages, hierarchy);
    expect(depths.get(1)).toBe(0);
    expect(depths.get(2)).toBe(1);
  });

  it('assigns depth 2 to grandchildren', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2), makePage(3)];
    const hierarchy: PageHierarchy = { 1: [2], 2: [3] };
    const depths = sh.calculatePageDepths(pages, hierarchy);
    expect(depths.get(3)).toBe(2);
  });

  it('handles circular references without infinite loop', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    // Circular: 1→2 and 2→1
    const hierarchy: PageHierarchy = { 1: [2], 2: [1] };
    expect(() => sh.calculatePageDepths(pages, hierarchy)).not.toThrow();
  });
});

// ─── getProcessingOrder ────────────────────────────────────────────────────────

describe('SitemapHierarchy.getProcessingOrder', () => {
  it('returns all pages in the ordered list', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2), makePage(3)];
    const hierarchy: PageHierarchy = { 1: [2, 3] };
    const { orderedPages } = sh.getProcessingOrder(pages, hierarchy);
    expect(orderedPages).toHaveLength(3);
  });

  it('ensures parents come before their children', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2), makePage(3)];
    const hierarchy: PageHierarchy = { 1: [2], 2: [3] };
    const { orderedPages } = sh.getProcessingOrder(pages, hierarchy);
    const idx = (id: number) => orderedPages.findIndex((p: any) => p.pageID === id);
    expect(idx(1)).toBeLessThan(idx(2));
    expect(idx(2)).toBeLessThan(idx(3));
  });

  it('returns depthInfo map alongside orderedPages', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const hierarchy: PageHierarchy = { 1: [2] };
    const { depthInfo } = sh.getProcessingOrder(pages, hierarchy);
    expect(depthInfo).toBeInstanceOf(Map);
    expect(depthInfo.get(1)).toBe(0);
    expect(depthInfo.get(2)).toBe(1);
  });
});

// ─── validateProcessingOrder ──────────────────────────────────────────────────

describe('SitemapHierarchy.validateProcessingOrder', () => {
  it('returns true for an empty page list', () => {
    const sh = new SitemapHierarchy();
    expect(sh.validateProcessingOrder([], {})).toBe(true);
  });

  it('returns true when processing order is dependency-safe', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const hierarchy: PageHierarchy = { 1: [2] };
    // Parent first, child second
    expect(sh.validateProcessingOrder(pages, hierarchy)).toBe(true);
  });

  it('returns false when a child is ordered before its parent', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(2), makePage(1)]; // child before parent
    const hierarchy: PageHierarchy = { 1: [2] };
    expect(sh.validateProcessingOrder(pages, hierarchy)).toBe(false);
  });
});

// ─── extractSiblingOrderFromSitemap ──────────────────────────────────────────

describe('SitemapHierarchy.extractSiblingOrderFromSitemap', () => {
  it('returns empty map for empty sitemap', () => {
    const sh = new SitemapHierarchy();
    expect(sh.extractSiblingOrderFromSitemap([])).toEqual(new Map());
  });

  it('maps each page to its next sibling (null for last)', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(1), makeNode(2), makeNode(3)];
    const order = sh.extractSiblingOrderFromSitemap(sitemap);
    expect(order.get(1)).toBe(2);
    expect(order.get(2)).toBe(3);
    expect(order.get(3)).toBeNull();
  });

  it('processes children recursively', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(1, [makeNode(10), makeNode(11)])];
    const order = sh.extractSiblingOrderFromSitemap(sitemap);
    expect(order.get(10)).toBe(11);
    expect(order.get(11)).toBeNull();
  });
});

// ─── getInsertBeforePageId ────────────────────────────────────────────────────

describe('SitemapHierarchy.getInsertBeforePageId', () => {
  it('returns null when page has no next sibling', () => {
    const sh = new SitemapHierarchy();
    const order = new Map<number, number | null>([[1, null]]);
    expect(sh.getInsertBeforePageId(1, order)).toBeNull();
  });

  it('returns the next sibling ID when one exists', () => {
    const sh = new SitemapHierarchy();
    const order = new Map<number, number | null>([[1, 5], [5, null]]);
    expect(sh.getInsertBeforePageId(1, order)).toBe(5);
  });

  it('returns null when page ID is not in the sibling map', () => {
    const sh = new SitemapHierarchy();
    const order = new Map<number, number | null>();
    expect(sh.getInsertBeforePageId(99, order)).toBeNull();
  });
});

// ─── getOrphanedPages ────────────────────────────────────────────────────────

describe('SitemapHierarchy.getOrphanedPages', () => {
  it('returns all pages when no groups exist', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const result = sh.getOrphanedPages(pages, []);
    expect(result).toHaveLength(2);
  });

  it('returns only pages not covered by any group', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2), makePage(3)];
    const groups = [
      { rootPage: makePage(1), childPages: [makePage(2)], allPageIds: new Set([1, 2]) },
    ];
    const orphans = sh.getOrphanedPages(pages, groups);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].pageID).toBe(3);
  });

  it('returns empty array when all pages are covered by groups', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2)];
    const groups = [
      { rootPage: makePage(1), childPages: [makePage(2)], allPageIds: new Set([1, 2]) },
    ];
    expect(sh.getOrphanedPages(pages, groups)).toHaveLength(0);
  });
});

// ─── buildPageHierarchyWithDynamicSupport ─────────────────────────────────────

describe('SitemapHierarchy.buildPageHierarchyWithDynamicSupport', () => {
  it('returns empty hierarchy for empty sitemap', () => {
    const sh = new SitemapHierarchy();
    expect(sh.buildPageHierarchyWithDynamicSupport([])).toEqual({});
  });

  it('maps parent page to its children IDs', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(1, [makeNode(2), makeNode(3)])];
    const hierarchy = sh.buildPageHierarchyWithDynamicSupport(sitemap);
    expect(hierarchy[1]).toEqual(expect.arrayContaining([2, 3]));
  });

  it('does not add duplicate child IDs for dynamic pages', () => {
    const sh = new SitemapHierarchy();
    const dynamicChild: SitemapNode = { ...makeNode(5), contentID: 100 };
    const sitemap = [makeNode(1, [dynamicChild])];
    const hierarchy = sh.buildPageHierarchyWithDynamicSupport(sitemap);
    const childIds = hierarchy[1];
    expect(childIds.filter((id: number) => id === 5)).toHaveLength(1);
  });
});

// ─── buildPageOrderingData ────────────────────────────────────────────────────

describe('SitemapHierarchy.buildPageOrderingData', () => {
  it('returns hierarchy, siblingOrder and parentToChildrenMap', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(1, [makeNode(2)])];
    const data = sh.buildPageOrderingData(sitemap);
    expect(data).toHaveProperty('hierarchy');
    expect(data).toHaveProperty('siblingOrder');
    expect(data).toHaveProperty('parentToChildrenMap');
  });

  it('populates parentToChildrenMap consistently with hierarchy', () => {
    const sh = new SitemapHierarchy();
    const sitemap = [makeNode(10, [makeNode(20), makeNode(30)])];
    const { hierarchy, parentToChildrenMap } = sh.buildPageOrderingData(sitemap);
    expect(parentToChildrenMap.get(10)).toEqual(hierarchy[10]);
  });
});

// ─── getPagesByDepth ──────────────────────────────────────────────────────────

describe('SitemapHierarchy.getPagesByDepth', () => {
  it('groups pages by their depth', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(1), makePage(2), makePage(3)];
    const depths = new Map([[1, 0], [2, 1], [3, 1]]);
    const byDepth = sh.getPagesByDepth(pages, depths);
    expect(byDepth.get(0)!.map((p: any) => p.pageID)).toEqual([1]);
    expect(byDepth.get(1)!.map((p: any) => p.pageID)).toEqual(expect.arrayContaining([2, 3]));
  });

  it('defaults to depth 0 for pages not in the depth map', () => {
    const sh = new SitemapHierarchy();
    const pages = [makePage(99)];
    const byDepth = sh.getPagesByDepth(pages, new Map());
    expect(byDepth.get(0)!.map((p: any) => p.pageID)).toContain(99);
  });
});
