import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState } from 'core/state';
import {
  loadLastPullTimestamps,
  saveLastPullTimestamps,
  updateEntityTypeTimestamp,
  getLastPullTimestamp,
  isEntityModifiedSinceLastPull,
  markPullStart,
  markPushStart,
  clearTimestamps,
  getIncrementalPullDecision,
  LastPullTimestamps,
} from '../timestamp-tracker';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-ts-tracker-'));
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

// Helper: unique sub-directory rooted under tmpDir so each test is isolated.
function makeSubDir(name: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Resolve the timestamp file path exactly as the module does.
function timestampFilePath(rootPath: string, guid: string): string {
  return path.resolve(rootPath, guid, '.last-pull-timestamps.json');
}

// ---------------------------------------------------------------------------
// loadLastPullTimestamps
// ---------------------------------------------------------------------------
describe('loadLastPullTimestamps', () => {
  it('returns an empty object when no timestamp file exists', () => {
    const rootPath = makeSubDir('load-missing');
    const result = loadLastPullTimestamps('test-guid', rootPath);
    expect(result).toEqual({});
  });

  it('returns parsed timestamps from a valid file', () => {
    const rootPath = makeSubDir('load-valid');
    const guid = 'g1';
    const filePath = timestampFilePath(rootPath, guid);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const data: LastPullTimestamps = {
      models: '2025-01-01T00:00:00.000Z',
      content: '2025-02-15T12:30:00.000Z',
    };
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');

    const result = loadLastPullTimestamps(guid, rootPath);

    expect(result.models).toBe('2025-01-01T00:00:00.000Z');
    expect(result.content).toBe('2025-02-15T12:30:00.000Z');
  });

  it('skips (and warns about) invalid timestamp values', () => {
    const rootPath = makeSubDir('load-invalid-ts');
    const guid = 'g2';
    const filePath = timestampFilePath(rootPath, guid);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ models: 'not-a-date', assets: '2025-03-01T00:00:00.000Z' }),
      'utf-8'
    );

    const result = loadLastPullTimestamps(guid, rootPath);

    expect(result.models).toBeUndefined();
    expect(result.assets).toBe('2025-03-01T00:00:00.000Z');
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns empty object and warns when file contains malformed JSON', () => {
    const rootPath = makeSubDir('load-bad-json');
    const guid = 'g3';
    const filePath = timestampFilePath(rootPath, guid);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'NOT { valid json }', 'utf-8');

    const result = loadLastPullTimestamps(guid, rootPath);

    expect(result).toEqual({});
    expect(console.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// saveLastPullTimestamps
// ---------------------------------------------------------------------------
describe('saveLastPullTimestamps', () => {
  it('creates the directory and writes a valid JSON file', () => {
    const rootPath = makeSubDir('save-creates-dir');
    const guid = 'sg1';
    const timestamps: LastPullTimestamps = { models: '2025-05-01T00:00:00.000Z' };

    saveLastPullTimestamps(guid, rootPath, timestamps);

    const filePath = timestampFilePath(rootPath, guid);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.models).toBe('2025-05-01T00:00:00.000Z');
  });

  it('sorts keys in canonical order', () => {
    const rootPath = makeSubDir('save-sorted-keys');
    const guid = 'sg2';
    const timestamps: LastPullTimestamps = {
      galleries: '2025-01-06T00:00:00.000Z',
      models: '2025-01-01T00:00:00.000Z',
      assets: '2025-01-04T00:00:00.000Z',
    };

    saveLastPullTimestamps(guid, rootPath, timestamps);

    const filePath = timestampFilePath(rootPath, guid);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const keys = Object.keys(content);
    expect(keys.indexOf('models')).toBeLessThan(keys.indexOf('assets'));
    expect(keys.indexOf('assets')).toBeLessThan(keys.indexOf('galleries'));
  });

  it('omits entity types not present in timestamps', () => {
    const rootPath = makeSubDir('save-omits-empty');
    const guid = 'sg3';
    saveLastPullTimestamps(guid, rootPath, { pages: '2025-04-01T00:00:00.000Z' });

    const filePath = timestampFilePath(rootPath, guid);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(Object.keys(content)).toEqual(['pages']);
  });

  it('overwrites an existing timestamp file', () => {
    const rootPath = makeSubDir('save-overwrites');
    const guid = 'sg4';
    saveLastPullTimestamps(guid, rootPath, { models: '2025-01-01T00:00:00.000Z' });
    saveLastPullTimestamps(guid, rootPath, { models: '2025-06-01T00:00:00.000Z' });

    const filePath = timestampFilePath(rootPath, guid);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.models).toBe('2025-06-01T00:00:00.000Z');
  });

  it('logs success after saving', () => {
    const rootPath = makeSubDir('save-logs');
    saveLastPullTimestamps('lg1', rootPath, { assets: '2025-01-01T00:00:00.000Z' });
    expect(console.log).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateEntityTypeTimestamp
// ---------------------------------------------------------------------------
describe('updateEntityTypeTimestamp', () => {
  it('adds a new entity type timestamp to an existing file', () => {
    const rootPath = makeSubDir('update-add-key');
    const guid = 'ug1';
    saveLastPullTimestamps(guid, rootPath, { models: '2025-01-01T00:00:00.000Z' });

    updateEntityTypeTimestamp(guid, rootPath, 'assets', '2025-03-01T00:00:00.000Z');

    const result = loadLastPullTimestamps(guid, rootPath);
    expect(result.models).toBe('2025-01-01T00:00:00.000Z');
    expect(result.assets).toBe('2025-03-01T00:00:00.000Z');
  });

  it('updates an existing entity type timestamp', () => {
    const rootPath = makeSubDir('update-overwrite-key');
    const guid = 'ug2';
    saveLastPullTimestamps(guid, rootPath, { models: '2025-01-01T00:00:00.000Z' });

    updateEntityTypeTimestamp(guid, rootPath, 'models', '2025-07-01T00:00:00.000Z');

    const result = loadLastPullTimestamps(guid, rootPath);
    expect(result.models).toBe('2025-07-01T00:00:00.000Z');
  });

  it('creates the file when it does not yet exist', () => {
    const rootPath = makeSubDir('update-creates-file');
    const guid = 'ug3';

    updateEntityTypeTimestamp(guid, rootPath, 'pages', '2025-05-01T00:00:00.000Z');

    const result = loadLastPullTimestamps(guid, rootPath);
    expect(result.pages).toBe('2025-05-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// getLastPullTimestamp
// ---------------------------------------------------------------------------
describe('getLastPullTimestamp', () => {
  it('returns the timestamp string for a known entity type', () => {
    const rootPath = makeSubDir('getlast-found');
    const guid = 'gl1';
    saveLastPullTimestamps(guid, rootPath, { containers: '2025-04-10T08:00:00.000Z' });

    const result = getLastPullTimestamp(guid, rootPath, 'containers');
    expect(result).toBe('2025-04-10T08:00:00.000Z');
  });

  it('returns null when entity type is not in the file', () => {
    const rootPath = makeSubDir('getlast-missing-key');
    const guid = 'gl2';
    saveLastPullTimestamps(guid, rootPath, { models: '2025-01-01T00:00:00.000Z' });

    const result = getLastPullTimestamp(guid, rootPath, 'assets');
    expect(result).toBeNull();
  });

  it('returns null when no timestamp file exists', () => {
    const rootPath = makeSubDir('getlast-no-file');
    const result = getLastPullTimestamp('no-guid', rootPath, 'pages');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isEntityModifiedSinceLastPull
// ---------------------------------------------------------------------------
describe('isEntityModifiedSinceLastPull', () => {
  it('returns true when entityModifiedDate is null (default to modified)', () => {
    expect(isEntityModifiedSinceLastPull(null, '2025-01-01T00:00:00.000Z')).toBe(true);
  });

  it('returns true when lastPullTimestamp is null (first pull)', () => {
    expect(isEntityModifiedSinceLastPull('2025-06-01T00:00:00.000Z', null)).toBe(true);
  });

  it('returns true when entity was modified after last pull', () => {
    expect(
      isEntityModifiedSinceLastPull('2025-06-02T00:00:00.000Z', '2025-06-01T00:00:00.000Z')
    ).toBe(true);
  });

  it('returns false when entity was modified before last pull', () => {
    expect(
      isEntityModifiedSinceLastPull('2025-05-31T00:00:00.000Z', '2025-06-01T00:00:00.000Z')
    ).toBe(false);
  });

  it('returns false when entity modified date equals last pull timestamp', () => {
    const ts = '2025-06-01T00:00:00.000Z';
    expect(isEntityModifiedSinceLastPull(ts, ts)).toBe(false);
  });

  it('returns true (and warns) when entityModifiedDate is an invalid date', () => {
    expect(isEntityModifiedSinceLastPull('bad-date', '2025-06-01T00:00:00.000Z')).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns true (and warns) when lastPullTimestamp is an invalid date', () => {
    expect(isEntityModifiedSinceLastPull('2025-06-01T00:00:00.000Z', 'bad-date')).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// markPullStart / markPushStart
// ---------------------------------------------------------------------------
describe('markPullStart', () => {
  it('returns a valid ISO 8601 timestamp close to now', () => {
    const before = Date.now();
    const ts = markPullStart();
    const after = Date.now();

    expect(typeof ts).toBe('string');
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe('markPushStart', () => {
  it('returns a valid ISO 8601 timestamp close to now', () => {
    const before = Date.now();
    const ts = markPushStart();
    const after = Date.now();

    expect(typeof ts).toBe('string');
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// clearTimestamps
// ---------------------------------------------------------------------------
describe('clearTimestamps', () => {
  it('removes the timestamp file when it exists', () => {
    const rootPath = makeSubDir('clear-exists');
    const guid = 'cl1';
    saveLastPullTimestamps(guid, rootPath, { models: '2025-01-01T00:00:00.000Z' });

    clearTimestamps(guid, rootPath);

    const filePath = timestampFilePath(rootPath, guid);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does not throw when timestamp file does not exist', () => {
    const rootPath = makeSubDir('clear-no-file');
    expect(() => clearTimestamps('no-guid', rootPath)).not.toThrow();
  });

  it('logs when clearing an existing file', () => {
    const rootPath = makeSubDir('clear-logs');
    const guid = 'cl2';
    saveLastPullTimestamps(guid, rootPath, { assets: '2025-01-01T00:00:00.000Z' });
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    clearTimestamps(guid, rootPath);

    expect(console.log).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getIncrementalPullDecision
// ---------------------------------------------------------------------------
describe('getIncrementalPullDecision', () => {
  it('returns "full" for "templates" regardless of stored timestamps', () => {
    const rootPath = makeSubDir('decision-templates');
    const guid = 'pd1';
    saveLastPullTimestamps(guid, rootPath, { templates: '2025-01-01T00:00:00.000Z' });

    expect(getIncrementalPullDecision(guid, rootPath, 'templates')).toBe('full');
  });

  it('returns "full" when no previous pull timestamp exists for entity type', () => {
    const rootPath = makeSubDir('decision-full-no-ts');
    expect(getIncrementalPullDecision('no-guid', rootPath, 'models')).toBe('full');
  });

  it('returns "incremental" when a previous pull timestamp exists', () => {
    const rootPath = makeSubDir('decision-incremental');
    const guid = 'pd2';
    saveLastPullTimestamps(guid, rootPath, { models: '2025-01-01T00:00:00.000Z' });

    expect(getIncrementalPullDecision(guid, rootPath, 'models')).toBe('incremental');
  });

  it.each(['models', 'containers', 'content', 'assets', 'pages', 'galleries'])(
    'returns "full" on first pull for entity type "%s"',
    (entityType) => {
      const rootPath = makeSubDir(`decision-first-pull-${entityType}`);
      expect(getIncrementalPullDecision('fresh-guid', rootPath, entityType)).toBe('full');
    }
  );

  it('is case-insensitive for "templates"', () => {
    const rootPath = makeSubDir('decision-templates-case');
    expect(getIncrementalPullDecision('any', rootPath, 'TEMPLATES')).toBe('full');
    expect(getIncrementalPullDecision('any', rootPath, 'Templates')).toBe('full');
  });
});
