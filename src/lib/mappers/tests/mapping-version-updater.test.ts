import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';

// Mock the filesystem getters to avoid real I/O beyond what we control
jest.mock('lib/getters/filesystem/get-content-items', () => ({
  getContentItemsFromFileSystem: jest.fn(),
}));
jest.mock('lib/getters/filesystem/get-pages', () => ({
  getPagesFromFileSystem: jest.fn(),
}));

// Import after mocks are in place
import { getContentItemsFromFileSystem } from 'lib/getters/filesystem/get-content-items';
import { getPagesFromFileSystem } from 'lib/getters/filesystem/get-pages';
import {
  updateContentMappingsAfterPublish,
  updatePageMappingsAfterPublish,
  updateMappingsAfterPublish,
  VersionChangeDetail,
} from 'lib/mappers/mapping-version-updater';
import { ContentItemMapper } from 'lib/mappers/content-item-mapper';
import { PageMapper } from 'lib/mappers/page-mapper';

const mockGetContentItems = getContentItemsFromFileSystem as jest.MockedFunction<typeof getContentItemsFromFileSystem>;
const mockGetPages = getPagesFromFileSystem as jest.MockedFunction<typeof getPagesFromFileSystem>;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-mapping-version-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  testCounter++;
  SRC = `src-${testCounter}`;
  TGT = `tgt-${testCounter}`;
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockGetContentItems.mockReturnValue([]);
  mockGetPages.mockReturnValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

let testCounter = 0;
const LOCALE = 'en-us';
let SRC: string;
let TGT: string;

function makeContentItem(overrides: Record<string, any> = {}): any {
  return {
    contentID: 100,
    properties: { versionID: 1, referenceName: 'ref', definitionName: 'Model', state: 2 },
    fields: { title: 'Test' },
    ...overrides,
  };
}

function makePage(overrides: Record<string, any> = {}): any {
  return {
    pageID: 50,
    title: 'Test Page',
    name: 'test-page',
    templateName: 'TwoCol',
    properties: { versionID: 1 },
    ...overrides,
  };
}

function seedContentMapper(sourceID: number, targetID: number, versionID: number = 1): void {
  const mapper = new ContentItemMapper(SRC, TGT, LOCALE);
  mapper.addMapping(makeContentItem({ contentID: sourceID }), makeContentItem({ contentID: targetID, properties: { versionID } }));
}

function seedPageMapper(sourceID: number, targetID: number, versionID: number = 1): void {
  const mapper = new PageMapper(SRC, TGT, LOCALE);
  mapper.addMapping(makePage({ pageID: sourceID }), makePage({ pageID: targetID, properties: { versionID } }));
}

// ─── updateContentMappingsAfterPublish ────────────────────────────────────────

describe('updateContentMappingsAfterPublish', () => {
  it('returns zero updated when publishedContentIds is empty', async () => {
    const result = await updateContentMappingsAfterPublish([], SRC, TGT, LOCALE);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('deduplicates published content IDs before processing', async () => {
    mockGetContentItems.mockReturnValue([]);
    const result = await updateContentMappingsAfterPublish([100, 100, 100], SRC, TGT, LOCALE);
    // 100 is not found in filesystem → one error, not three
    expect(result.errors).toHaveLength(1);
  });

  it('records an error when a content item is not found in target filesystem', async () => {
    mockGetContentItems.mockReturnValue([]);
    const result = await updateContentMappingsAfterPublish([999], SRC, TGT, LOCALE);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/999/);
  });

  it('records an error when no mapping exists for a target content ID', async () => {
    const targetItem = makeContentItem({ contentID: 200, properties: { versionID: 7 } });
    mockGetContentItems.mockReturnValue([targetItem]);
    const result = await updateContentMappingsAfterPublish([200], SRC, TGT, LOCALE);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/200/);
  });

  it('updates the mapping successfully when item and mapping exist', async () => {
    seedContentMapper(10, 20, 5);
    const targetItem = makeContentItem({ contentID: 20, properties: { versionID: 9 } });
    mockGetContentItems.mockReturnValue([targetItem]);
    const result = await updateContentMappingsAfterPublish([20], SRC, TGT, LOCALE);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.changes[0].newVersion).toBe(9);
  });

  it('tracks change.changed as false when versionID is already up to date', async () => {
    seedContentMapper(10, 20, 5);
    const targetItem = makeContentItem({ contentID: 20, properties: { versionID: 5 } });
    mockGetContentItems.mockReturnValue([targetItem]);
    const result = await updateContentMappingsAfterPublish([20], SRC, TGT, LOCALE);
    expect(result.changes[0].changed).toBe(false);
  });
});

// ─── updatePageMappingsAfterPublish ───────────────────────────────────────────

describe('updatePageMappingsAfterPublish', () => {
  it('returns zero updated when publishedPageIds is empty', async () => {
    const result = await updatePageMappingsAfterPublish([], SRC, TGT, LOCALE);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('records an error when a page is not found in target filesystem', async () => {
    mockGetPages.mockReturnValue([]);
    const result = await updatePageMappingsAfterPublish([999], SRC, TGT, LOCALE);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/999/);
  });

  it('records an error when no mapping exists for a target page ID', async () => {
    const targetPage = makePage({ pageID: 500, properties: { versionID: 3 } });
    mockGetPages.mockReturnValue([targetPage]);
    const result = await updatePageMappingsAfterPublish([500], SRC, TGT, LOCALE);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/500/);
  });

  it('updates the mapping successfully when page and mapping exist', async () => {
    seedPageMapper(1, 50, 1);
    const targetPage = makePage({ pageID: 50, properties: { versionID: 8 } });
    mockGetPages.mockReturnValue([targetPage]);
    const result = await updatePageMappingsAfterPublish([50], SRC, TGT, LOCALE);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.changes[0].newVersion).toBe(8);
  });
});

// ─── updateMappingsAfterPublish ───────────────────────────────────────────────

describe('updateMappingsAfterPublish', () => {
  it('returns a result and logLines', async () => {
    const { result, logLines } = await updateMappingsAfterPublish([], [], SRC, TGT, LOCALE);
    expect(result).toHaveProperty('contentMappingsUpdated');
    expect(result).toHaveProperty('pageMappingsUpdated');
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(logLines)).toBe(true);
  });

  it('processes both content and page IDs', async () => {
    seedContentMapper(10, 20, 1);
    const targetContent = makeContentItem({ contentID: 20, properties: { versionID: 2 } });
    mockGetContentItems.mockReturnValue([targetContent]);

    seedPageMapper(1, 50, 1);
    const targetPage = makePage({ pageID: 50, properties: { versionID: 2 } });
    mockGetPages.mockReturnValue([targetPage]);

    const { result } = await updateMappingsAfterPublish([20], [50], SRC, TGT, LOCALE);
    expect(result.contentMappingsUpdated).toBe(1);
    expect(result.pageMappingsUpdated).toBe(1);
  });

  it('accumulates errors from both content and page processing', async () => {
    mockGetContentItems.mockReturnValue([]);
    mockGetPages.mockReturnValue([]);
    const { result } = await updateMappingsAfterPublish([999], [888], SRC, TGT, LOCALE);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── VersionChangeDetail helpers (formatVersionChange is private but we verify its effect via logLines) ─

describe('VersionChangeDetail structure', () => {
  it('includes expected fields in change objects', async () => {
    seedContentMapper(10, 20, 5);
    const targetItem = makeContentItem({ contentID: 20, properties: { versionID: 9 } });
    mockGetContentItems.mockReturnValue([targetItem]);
    const result = await updateContentMappingsAfterPublish([20], SRC, TGT, LOCALE);
    const change = result.changes[0];
    expect(change).toMatchObject({
      id: 20,
      oldVersion: 5,
      newVersion: 9,
      changed: true,
    });
    expect(change.name).toBeDefined();
  });
});
