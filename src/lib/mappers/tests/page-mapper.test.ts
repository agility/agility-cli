import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { PageMapper } from 'lib/mappers/page-mapper';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-page-mapper-'));
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

function makeMapper(): PageMapper {
  testCounter++;
  currentSrc = `src-${testCounter}`;
  currentTgt = `tgt-${testCounter}`;
  return new PageMapper(currentSrc, currentTgt, LOCALE);
}

function makePage(overrides: Record<string, any> = {}): any {
  return {
    pageID: 10,
    title: 'Home',
    name: 'home',
    templateName: 'OneCol',
    properties: { versionID: 1 },
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('PageMapper constructor', () => {
  it('constructs without throwing', () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── getPageMapping ───────────────────────────────────────────────────────────

describe('PageMapper.getPageMapping', () => {
  it('returns null when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.getPageMapping(makePage({ pageID: 999 }), 'source')).toBeNull();
  });

  it('finds mapping by source pageID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20 }));
    expect(mapper.getPageMapping(makePage({ pageID: 10 }), 'source')).not.toBeNull();
  });

  it('finds mapping by target pageID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20 }));
    const found = mapper.getPageMapping(makePage({ pageID: 20 }), 'target');
    expect(found!.targetPageID).toBe(20);
  });
});

// ─── getPageMappingByPageID ───────────────────────────────────────────────────

describe('PageMapper.getPageMappingByPageID', () => {
  it('returns null for unknown ID', () => {
    const mapper = makeMapper();
    expect(mapper.getPageMappingByPageID(999, 'source')).toBeNull();
  });

  it('returns mapping by source pageID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 5 }), makePage({ pageID: 6 }));
    expect(mapper.getPageMappingByPageID(5, 'source')).not.toBeNull();
  });

  it('returns mapping by target pageID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 5 }), makePage({ pageID: 6 }));
    expect(mapper.getPageMappingByPageID(6, 'target')).not.toBeNull();
  });
});

// ─── getPageMappingByPageTemplateName ────────────────────────────────────────

describe('PageMapper.getPageMappingByPageTemplateName', () => {
  it('returns null when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.getPageMappingByPageTemplateName('Unknown', 'source')).toBeNull();
  });

  it('finds by source templateName (exact match)', () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makePage({ pageID: 10, templateName: 'TwoCol' }),
      makePage({ pageID: 20, templateName: 'TwoColTarget' }),
    );
    expect(mapper.getPageMappingByPageTemplateName('TwoCol', 'source')).not.toBeNull();
  });

  it('finds by target templateName', () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makePage({ pageID: 10, templateName: 'TwoCol' }),
      makePage({ pageID: 20, templateName: 'TwoColTarget' }),
    );
    expect(mapper.getPageMappingByPageTemplateName('TwoColTarget', 'target')).not.toBeNull();
  });
});

// ─── getMappedEntity ──────────────────────────────────────────────────────────

describe('PageMapper.getMappedEntity', () => {
  it('returns null when mapping is null', () => {
    const mapper = makeMapper();
    expect(mapper.getMappedEntity(null as any, 'source')).toBeNull();
  });

  it('returns null when the page file does not exist', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20 }));
    const mapping = mapper.getPageMappingByPageID(20, 'target')!;
    expect(mapper.getMappedEntity(mapping, 'target')).toBeNull();
  });

  it('returns the page when the file exists', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20 }));
    const mapping = mapper.getPageMappingByPageID(20, 'target')!;

    const pageDir = path.join(tmpDir, currentTgt, LOCALE, 'page');
    fs.mkdirSync(pageDir, { recursive: true });
    const pageData = { pageID: 20, title: 'Home', name: 'home', templateName: 'OneCol', properties: { versionID: 1 } };
    fs.writeFileSync(path.join(pageDir, '20.json'), JSON.stringify(pageData));

    const result = mapper.getMappedEntity(mapping, 'target');
    expect(result).not.toBeNull();
    expect((result as any).pageID).toBe(20);
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe('PageMapper.addMapping', () => {
  it('adds a new mapping', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20 }));
    expect(mapper.getPageMappingByPageID(20, 'target')).not.toBeNull();
  });

  it('updates existing mapping when target pageID already exists', () => {
    const mapper = makeMapper();
    const tgt = makePage({ pageID: 20, properties: { versionID: 1 } });
    mapper.addMapping(makePage({ pageID: 10, properties: { versionID: 1 } }), tgt);
    mapper.addMapping(makePage({ pageID: 11, properties: { versionID: 2 } }), tgt);
    const found = mapper.getPageMappingByPageID(20, 'target')!;
    expect(found.sourcePageID).toBe(11);
    expect(found.sourceVersionID).toBe(2);
  });
});

// ─── hasSourceChanged ─────────────────────────────────────────────────────────

describe('PageMapper.hasSourceChanged', () => {
  it('returns true when no mapping exists (treat as new/changed)', () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(makePage({ pageID: 999, properties: { versionID: 1 } }))).toBe(true);
  });

  it('returns false when versionID matches', () => {
    const mapper = makeMapper();
    const src = makePage({ pageID: 10, properties: { versionID: 5 } });
    mapper.addMapping(src, makePage({ pageID: 20 }));
    expect(mapper.hasSourceChanged(makePage({ pageID: 10, properties: { versionID: 5 } }))).toBe(false);
  });

  it('returns true when source versionID is greater than mapped', () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makePage({ pageID: 10, properties: { versionID: 3 } }),
      makePage({ pageID: 20 }),
    );
    expect(mapper.hasSourceChanged(makePage({ pageID: 10, properties: { versionID: 7 } }))).toBe(true);
  });
});

// ─── hasTargetChanged ─────────────────────────────────────────────────────────

describe('PageMapper.hasTargetChanged', () => {
  it('returns null when mapping is null', () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(makePage(), null)).toBeNull();
  });

  it('returns file_missing when targetPage is null but mapping exists', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20 }));
    const mapping = mapper.getPageMappingByPageID(20, 'target')!;
    expect(mapper.hasTargetChanged(null, mapping)).toBe('file_missing');
  });

  it('returns null when targetPage versionID equals mapping versionID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20, properties: { versionID: 5 } }));
    const mapping = mapper.getPageMappingByPageID(20, 'target')!;
    const targetPage = makePage({ pageID: 20, properties: { versionID: 5 } });
    expect(mapper.hasTargetChanged(targetPage, mapping)).toBeNull();
  });

  it('returns version_changed when targetPage versionID is greater than mapping', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20, properties: { versionID: 5 } }));
    const mapping = mapper.getPageMappingByPageID(20, 'target')!;
    const targetPage = makePage({ pageID: 20, properties: { versionID: 10 } });
    expect(mapper.hasTargetChanged(targetPage, mapping)).toBe('version_changed');
  });
});

// ─── updateTargetVersionID ────────────────────────────────────────────────────

describe('PageMapper.updateTargetVersionID', () => {
  it('returns success:false when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.updateTargetVersionID(999, 42)).toEqual({ success: false });
  });

  it('returns success:true with old and new versionIDs', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20, properties: { versionID: 5 } }));
    const result = mapper.updateTargetVersionID(20, 10);
    expect(result.success).toBe(true);
    expect(result.oldVersionID).toBe(5);
    expect(result.newVersionID).toBe(10);
  });

  it('does not call saveMapping when versionID is unchanged', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20, properties: { versionID: 5 } }));
    const saveSpy = jest.spyOn(mapper as any, 'saveMapping');
    mapper.updateTargetVersionID(20, 5);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('calls saveMapping when versionID changes', () => {
    const mapper = makeMapper();
    mapper.addMapping(makePage({ pageID: 10 }), makePage({ pageID: 20, properties: { versionID: 5 } }));
    const saveSpy = jest.spyOn(mapper as any, 'saveMapping');
    mapper.updateTargetVersionID(20, 99);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});
