import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState } from 'core/state';

// store-interface-filesystem uses require() and module.exports so we import it that way
const storeInterface = require('lib/downloaders/store-interface-filesystem');

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeOptions(subDir = 'default') {
  const rootPath = path.join(tmpDir, subDir);
  fs.mkdirSync(rootPath, { recursive: true });
  return { rootPath, logger: null };
}

// ─── initializeProgress ───────────────────────────────────────────────────────

describe('initializeProgress', () => {
  it('does not throw when called with a rootPath', () => {
    expect(() => storeInterface.initializeProgress(path.join(tmpDir, 'init1'))).not.toThrow();
  });

  it('does not throw when called without a rootPath', () => {
    expect(() => storeInterface.initializeProgress()).not.toThrow();
  });

  it('resets progress stats so getProgressStats returns zero items', () => {
    const rootPath = path.join(tmpDir, 'init-reset');
    storeInterface.updateProgress('item', 1, rootPath);
    storeInterface.initializeProgress(rootPath);
    const stats = storeInterface.getCurrentProgress(rootPath);
    expect(stats.totalItems).toBe(0);
  });
});

// ─── updateProgress ───────────────────────────────────────────────────────────

describe('updateProgress', () => {
  it('increments totalItems after each call', () => {
    const rootPath = path.join(tmpDir, 'up1');
    storeInterface.initializeProgress(rootPath);

    storeInterface.updateProgress('item', 1, rootPath);
    storeInterface.updateProgress('item', 2, rootPath);

    const stats = storeInterface.getCurrentProgress(rootPath);
    expect(stats.totalItems).toBe(2);
  });

  it('tracks counts per item type', () => {
    const rootPath = path.join(tmpDir, 'up2');
    storeInterface.initializeProgress(rootPath);

    storeInterface.updateProgress('item', 1, rootPath);
    storeInterface.updateProgress('item', 2, rootPath);
    storeInterface.updateProgress('page', 3, rootPath);

    const stats = storeInterface.getCurrentProgress(rootPath);
    expect(stats.itemsByType['item']).toBe(2);
    expect(stats.itemsByType['page']).toBe(1);
  });

  it('instances are isolated by rootPath', () => {
    const rootPathA = path.join(tmpDir, 'up-a');
    const rootPathB = path.join(tmpDir, 'up-b');
    storeInterface.initializeProgress(rootPathA);
    storeInterface.initializeProgress(rootPathB);

    storeInterface.updateProgress('item', 1, rootPathA);
    storeInterface.updateProgress('item', 2, rootPathA);
    storeInterface.updateProgress('item', 3, rootPathB);

    const statsA = storeInterface.getCurrentProgress(rootPathA);
    const statsB = storeInterface.getCurrentProgress(rootPathB);
    expect(statsA.totalItems).toBe(2);
    expect(statsB.totalItems).toBe(1);
  });
});

// ─── getCurrentProgress (alias for getProgressStats) ─────────────────────────

describe('getCurrentProgress', () => {
  it('returns zero totalItems for a fresh rootPath', () => {
    const rootPath = path.join(tmpDir, 'gp-fresh');
    storeInterface.initializeProgress(rootPath);
    const stats = storeInterface.getCurrentProgress(rootPath);
    expect(stats.totalItems).toBe(0);
  });

  it('returns non-negative elapsedTime', () => {
    const rootPath = path.join(tmpDir, 'gp-elapsed');
    storeInterface.initializeProgress(rootPath);
    const stats = storeInterface.getCurrentProgress(rootPath);
    expect(stats.elapsedTime).toBeGreaterThanOrEqual(0);
  });

  it('recentActivity contains at most 10 entries', () => {
    const rootPath = path.join(tmpDir, 'gp-recent');
    storeInterface.initializeProgress(rootPath);
    for (let i = 0; i < 15; i++) {
      storeInterface.updateProgress('item', i, rootPath);
    }
    const stats = storeInterface.getCurrentProgress(rootPath);
    expect(stats.recentActivity.length).toBeLessThanOrEqual(10);
  });
});

// ─── setProgressCallback ──────────────────────────────────────────────────────

describe('setProgressCallback', () => {
  it('does not throw when callback is null', () => {
    expect(() => storeInterface.setProgressCallback(null, path.join(tmpDir, 'cb-null'))).not.toThrow();
  });

  it('invokes the callback when an item is updated', () => {
    const rootPath = path.join(tmpDir, 'cb-invoke');
    storeInterface.initializeProgress(rootPath);
    const cb = jest.fn();
    storeInterface.setProgressCallback(cb, rootPath);

    storeInterface.updateProgress('item', 42, rootPath);

    expect(cb).toHaveBeenCalledTimes(1);
    const calledWith = cb.mock.calls[0][0];
    expect(calledWith).toHaveProperty('totalItems', 1);

    // Clean up
    storeInterface.setProgressCallback(null, rootPath);
  });
});

// ─── cleanupProgressData ──────────────────────────────────────────────────────

describe('cleanupProgressData', () => {
  it('does not throw on an empty stats store', () => {
    const rootPath = path.join(tmpDir, 'cleanup1');
    expect(() => storeInterface.cleanupProgressData(rootPath)).not.toThrow();
  });
});

// ─── getAndClearSavedItemStats ────────────────────────────────────────────────

describe('getAndClearSavedItemStats', () => {
  it('returns a summary with totalItems', () => {
    const rootPath = path.join(tmpDir, 'gac-1');
    storeInterface.initializeProgress(rootPath);
    storeInterface.updateProgress('item', 1, rootPath);

    const result = storeInterface.getAndClearSavedItemStats(rootPath);

    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('totalItems');
  });

  it('clears progress after retrieval', () => {
    const rootPath = path.join(tmpDir, 'gac-2');
    storeInterface.initializeProgress(rootPath);
    storeInterface.updateProgress('item', 1, rootPath);
    storeInterface.getAndClearSavedItemStats(rootPath);

    const stats = storeInterface.getCurrentProgress(rootPath);
    expect(stats.totalItems).toBe(0);
  });

  it('returns itemsByType breakdown', () => {
    const rootPath = path.join(tmpDir, 'gac-3');
    storeInterface.initializeProgress(rootPath);
    storeInterface.updateProgress('page', 10, rootPath);

    const result = storeInterface.getAndClearSavedItemStats(rootPath);

    expect(result).toHaveProperty('itemsByType');
  });
});

// ─── saveItem ─────────────────────────────────────────────────────────────────

describe('saveItem', () => {
  it('writes a JSON file at the expected path', async () => {
    const rootPath = path.join(tmpDir, 'save-item-1');
    fs.mkdirSync(rootPath, { recursive: true });
    const options = { rootPath, logger: null };
    const item = { contentID: 99, title: 'test' };

    await storeInterface.saveItem({ options, item, itemType: 'item', languageCode: 'en-us', itemID: 99 });

    const expectedPath = path.join(rootPath, 'item', '99.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    expect(written.contentID).toBe(99);
  });

  it('does not throw when item is null (skips write)', async () => {
    const rootPath = path.join(tmpDir, 'save-null');
    fs.mkdirSync(rootPath, { recursive: true });
    const options = { rootPath, logger: null };

    await expect(
      storeInterface.saveItem({ options, item: null, itemType: 'item', languageCode: 'en-us', itemID: 1 })
    ).resolves.not.toThrow();
  });

  it('creates parent directories when they do not exist', async () => {
    const rootPath = path.join(tmpDir, 'save-mkdir');
    const options = { rootPath, logger: null };
    const item = { pageID: 5 };

    await storeInterface.saveItem({ options, item, itemType: 'page', languageCode: 'en-us', itemID: 5 });

    const expectedPath = path.join(rootPath, 'page', '5.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });
});

// ─── getItem ──────────────────────────────────────────────────────────────────

describe('getItem', () => {
  it('returns null when the file does not exist', async () => {
    const options = makeOptions('get-item-missing');
    const result = await storeInterface.getItem({ options, itemType: 'item', languageCode: 'en-us', itemID: 999 });
    expect(result).toBeNull();
  });

  it('returns the parsed JSON content of an existing file', async () => {
    const rootPath = path.join(tmpDir, 'get-item-exists');
    fs.mkdirSync(path.join(rootPath, 'item'), { recursive: true });
    const item = { contentID: 7, title: 'hello' };
    fs.writeFileSync(path.join(rootPath, 'item', '7.json'), JSON.stringify(item));

    const options = { rootPath, logger: null };
    const result = await storeInterface.getItem({ options, itemType: 'item', languageCode: 'en-us', itemID: 7 });

    expect(result).toEqual(item);
  });
});

// ─── deleteItem ───────────────────────────────────────────────────────────────

describe('deleteItem', () => {
  it('removes the file when it exists', async () => {
    const rootPath = path.join(tmpDir, 'delete-item');
    fs.mkdirSync(path.join(rootPath, 'item'), { recursive: true });
    const filePath = path.join(rootPath, 'item', '55.json');
    fs.writeFileSync(filePath, '{}');

    const options = { rootPath, logger: null };
    await storeInterface.deleteItem({ options, itemType: 'item', languageCode: 'en-us', itemID: 55 });

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does not throw when the file does not exist', async () => {
    const options = makeOptions('delete-missing');
    await expect(
      storeInterface.deleteItem({ options, itemType: 'item', languageCode: 'en-us', itemID: 12345 })
    ).resolves.not.toThrow();
  });
});

// ─── mergeItemToList ──────────────────────────────────────────────────────────

describe('mergeItemToList', () => {
  it('creates a new list when no existing list file is present', async () => {
    const rootPath = path.join(tmpDir, 'merge-new');
    fs.mkdirSync(rootPath, { recursive: true });
    const options = { rootPath, logger: null };
    const item = { contentID: 1, properties: { state: 1 }, title: 'First' };

    await storeInterface.mergeItemToList({
      options,
      item,
      languageCode: 'en-us',
      itemID: 1,
      referenceName: 'blogposts',
      definitionName: 'BlogPost',
    });

    const listPath = path.join(rootPath, 'list', 'blogposts.json');
    expect(fs.existsSync(listPath)).toBe(true);
    const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
    expect(list).toHaveLength(1);
    expect(list[0].contentID).toBe(1);
  });

  it('appends a new item to an existing list', async () => {
    const rootPath = path.join(tmpDir, 'merge-append');
    fs.mkdirSync(path.join(rootPath, 'list'), { recursive: true });
    const existingItem = { contentID: 1, properties: { state: 1 }, title: 'Existing' };
    fs.writeFileSync(path.join(rootPath, 'list', 'articles.json'), JSON.stringify([existingItem]));

    const options = { rootPath, logger: null };
    const newItem = { contentID: 2, properties: { state: 1 }, title: 'New' };

    await storeInterface.mergeItemToList({
      options,
      item: newItem,
      languageCode: 'en-us',
      itemID: 2,
      referenceName: 'articles',
      definitionName: 'Article',
    });

    const list = JSON.parse(fs.readFileSync(path.join(rootPath, 'list', 'articles.json'), 'utf8'));
    expect(list).toHaveLength(2);
  });

  it('replaces an existing item with the same contentID', async () => {
    const rootPath = path.join(tmpDir, 'merge-replace');
    fs.mkdirSync(path.join(rootPath, 'list'), { recursive: true });
    const oldItem = { contentID: 5, properties: { state: 1 }, title: 'Old' };
    fs.writeFileSync(path.join(rootPath, 'list', 'things.json'), JSON.stringify([oldItem]));

    const options = { rootPath, logger: null };
    const updatedItem = { contentID: 5, properties: { state: 1 }, title: 'Updated' };

    await storeInterface.mergeItemToList({
      options,
      item: updatedItem,
      languageCode: 'en-us',
      itemID: 5,
      referenceName: 'things',
      definitionName: 'Thing',
    });

    const list = JSON.parse(fs.readFileSync(path.join(rootPath, 'list', 'things.json'), 'utf8'));
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Updated');
  });

  it('removes an item from the list when state is 3 (deleted)', async () => {
    const rootPath = path.join(tmpDir, 'merge-delete');
    fs.mkdirSync(path.join(rootPath, 'list'), { recursive: true });
    const item1 = { contentID: 10, properties: { state: 1 }, title: 'Keep' };
    const item2 = { contentID: 11, properties: { state: 1 }, title: 'Remove' };
    fs.writeFileSync(path.join(rootPath, 'list', 'products.json'), JSON.stringify([item1, item2]));

    const options = { rootPath, logger: null };
    const deletedItem = { contentID: 11, properties: { state: 3 }, title: 'Remove' };

    await storeInterface.mergeItemToList({
      options,
      item: deletedItem,
      languageCode: 'en-us',
      itemID: 11,
      referenceName: 'products',
      definitionName: 'Product',
    });

    const list = JSON.parse(fs.readFileSync(path.join(rootPath, 'list', 'products.json'), 'utf8'));
    expect(list).toHaveLength(1);
    expect(list[0].contentID).toBe(10);
  });
});
