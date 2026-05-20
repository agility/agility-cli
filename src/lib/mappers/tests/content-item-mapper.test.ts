import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { ContentItemMapper } from 'lib/mappers/content-item-mapper';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-content-item-mapper-'));
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

let testCounter = 0;
const LOCALE = 'en-us';
let currentSrc: string;
let currentTgt: string;

function makeMapper(): ContentItemMapper {
  testCounter++;
  currentSrc = `src-${testCounter}`;
  currentTgt = `tgt-${testCounter}`;
  return new ContentItemMapper(currentSrc, currentTgt, LOCALE);
}

function makeItem(overrides: Record<string, any> = {}): any {
  return {
    contentID: 100,
    properties: {
      versionID: 1,
      referenceName: 'my-ref',
      definitionName: 'MyModel',
      state: 2,
    },
    fields: { title: 'Test Item' },
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('ContentItemMapper constructor', () => {
  it('constructs without throwing and exposes locale', () => {
    const mapper = makeMapper();
    expect(mapper.locale).toBe(LOCALE);
  });
});

// ─── getContentItemMapping ────────────────────────────────────────────────────

describe('ContentItemMapper.getContentItemMapping', () => {
  it('returns null when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.getContentItemMapping(makeItem({ contentID: 999 }), 'source')).toBeNull();
  });

  it('finds mapping by source contentID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20 }));
    expect(mapper.getContentItemMapping(makeItem({ contentID: 10 }), 'source')).not.toBeNull();
  });

  it('finds mapping by target contentID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20 }));
    const found = mapper.getContentItemMapping(makeItem({ contentID: 20 }), 'target');
    expect(found!.targetContentID).toBe(20);
  });
});

// ─── getContentItemMappingByContentID ────────────────────────────────────────

describe('ContentItemMapper.getContentItemMappingByContentID', () => {
  it('returns null for unknown ID', () => {
    const mapper = makeMapper();
    expect(mapper.getContentItemMappingByContentID(999, 'source')).toBeNull();
  });

  it('returns mapping by source contentID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 5 }), makeItem({ contentID: 6 }));
    expect(mapper.getContentItemMappingByContentID(5, 'source')).not.toBeNull();
  });

  it('returns mapping by target contentID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 5 }), makeItem({ contentID: 6 }));
    expect(mapper.getContentItemMappingByContentID(6, 'target')).not.toBeNull();
  });
});

// ─── getMappedEntity ──────────────────────────────────────────────────────────

describe('ContentItemMapper.getMappedEntity', () => {
  it('returns null when mapping is null', () => {
    const mapper = makeMapper();
    expect(mapper.getMappedEntity(null as any, 'source')).toBeNull();
  });

  it('returns null when mapping has no guid', () => {
    const mapper = makeMapper();
    const mapping = {
      sourceGuid: '',
      targetGuid: '',
      sourceContentID: 0,
      targetContentID: 0,
      sourceVersionID: 1,
      targetVersionID: 1,
    };
    expect(mapper.getMappedEntity(mapping as any, 'source')).toBeNull();
  });

  it('returns null when the content file does not exist on disk', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20 }));
    const mapping = mapper.getContentItemMappingByContentID(20, 'target')!;
    expect(mapper.getMappedEntity(mapping, 'target')).toBeNull();
  });

  it('returns the content item when the file exists and has properties', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20 }));
    const mapping = mapper.getContentItemMappingByContentID(20, 'target')!;

    // Write a fake content item file to the target location
    const itemDir = path.join(tmpDir, currentTgt, LOCALE, 'item');
    fs.mkdirSync(itemDir, { recursive: true });
    const itemData = { contentID: 20, properties: { versionID: 5 }, fields: {} };
    fs.writeFileSync(path.join(itemDir, '20.json'), JSON.stringify(itemData));

    const result = mapper.getMappedEntity(mapping, 'target');
    expect(result).not.toBeNull();
    expect((result as any).contentID).toBe(20);
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe('ContentItemMapper.addMapping', () => {
  it('adds a new mapping', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20 }));
    expect(mapper.getContentItemMappingByContentID(20, 'target')).not.toBeNull();
  });

  it('updates an existing mapping when target contentID already exists', () => {
    const mapper = makeMapper();
    const tgt = makeItem({ contentID: 20, properties: { versionID: 1 } });
    mapper.addMapping(makeItem({ contentID: 10, properties: { versionID: 1 } }), tgt);
    mapper.addMapping(makeItem({ contentID: 11, properties: { versionID: 2 } }), tgt);
    const found = mapper.getContentItemMappingByContentID(20, 'target')!;
    expect(found.sourceContentID).toBe(11);
    expect(found.sourceVersionID).toBe(2);
  });
});

// ─── hasSourceChanged ─────────────────────────────────────────────────────────

describe('ContentItemMapper.hasSourceChanged', () => {
  it('returns true when no mapping exists (treat as changed)', () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(makeItem({ contentID: 999, properties: { versionID: 1 } }))).toBe(true);
  });

  it('returns false when versionID matches mapping', () => {
    const mapper = makeMapper();
    const src = makeItem({ contentID: 10, properties: { versionID: 5 } });
    mapper.addMapping(src, makeItem({ contentID: 20 }));
    expect(mapper.hasSourceChanged(makeItem({ contentID: 10, properties: { versionID: 5 } }))).toBe(false);
  });

  it('returns true when source versionID is greater than mapped versionID', () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeItem({ contentID: 10, properties: { versionID: 5 } }),
      makeItem({ contentID: 20 }),
    );
    expect(mapper.hasSourceChanged(makeItem({ contentID: 10, properties: { versionID: 10 } }))).toBe(true);
  });
});

// ─── hasTargetChanged ─────────────────────────────────────────────────────────

describe('ContentItemMapper.hasTargetChanged', () => {
  it('returns false when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(makeItem({ contentID: 999 }))).toBe(false);
  });

  it('returns false when versionID matches', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20, properties: { versionID: 3 } }));
    expect(mapper.hasTargetChanged(makeItem({ contentID: 20, properties: { versionID: 3 } }))).toBe(false);
  });

  it('returns true when target versionID is greater than mapped versionID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20, properties: { versionID: 3 } }));
    expect(mapper.hasTargetChanged(makeItem({ contentID: 20, properties: { versionID: 9 } }))).toBe(true);
  });
});

// ─── updateTargetVersionID ────────────────────────────────────────────────────

describe('ContentItemMapper.updateTargetVersionID', () => {
  it('returns success:false when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.updateTargetVersionID(999, 42)).toEqual({ success: false });
  });

  it('returns success:true with old and new versionIDs when mapping exists', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20, properties: { versionID: 5 } }));
    const result = mapper.updateTargetVersionID(20, 10);
    expect(result.success).toBe(true);
    expect(result.oldVersionID).toBe(5);
    expect(result.newVersionID).toBe(10);
  });

  it('does not save mapping when versionID is unchanged', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20, properties: { versionID: 5 } }));
    const saveSpy = jest.spyOn(mapper as any, 'saveMapping');
    mapper.updateTargetVersionID(20, 5);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('saves mapping when versionID changes', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeItem({ contentID: 10 }), makeItem({ contentID: 20, properties: { versionID: 5 } }));
    const saveSpy = jest.spyOn(mapper as any, 'saveMapping');
    mapper.updateTargetVersionID(20, 99);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});
