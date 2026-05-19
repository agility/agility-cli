import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { GalleryMapper } from 'lib/mappers/gallery-mapper';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-gallery-mapper-'));
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

function makeMapper(): GalleryMapper {
  testCounter++;
  return new GalleryMapper(`src-${testCounter}`, `tgt-${testCounter}`);
}

function makeGallery(overrides: Record<string, any> = {}): any {
  return {
    mediaGroupingID: 1,
    modifiedOn: '01/01/2024 10:00AM',
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('GalleryMapper constructor', () => {
  it('constructs without throwing', () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── getGalleryMapping ────────────────────────────────────────────────────────

describe('GalleryMapper.getGalleryMapping', () => {
  it('returns null when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.getGalleryMapping(makeGallery({ mediaGroupingID: 999 }), 'source')).toBeNull();
  });

  it('finds mapping by source mediaGroupingID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeGallery({ mediaGroupingID: 10 }), makeGallery({ mediaGroupingID: 20 }));
    expect(mapper.getGalleryMapping(makeGallery({ mediaGroupingID: 10 }), 'source')).not.toBeNull();
  });

  it('finds mapping by target mediaGroupingID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeGallery({ mediaGroupingID: 10 }), makeGallery({ mediaGroupingID: 20 }));
    const found = mapper.getGalleryMapping(makeGallery({ mediaGroupingID: 20 }), 'target');
    expect(found!.targetMediaGroupingID).toBe(20);
  });
});

// ─── getGalleryMappingByMediaGroupingID ───────────────────────────────────────

describe('GalleryMapper.getGalleryMappingByMediaGroupingID', () => {
  it('returns null for unknown ID', () => {
    const mapper = makeMapper();
    expect(mapper.getGalleryMappingByMediaGroupingID(999, 'source')).toBeNull();
  });

  it('returns mapping by source mediaGroupingID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeGallery({ mediaGroupingID: 5 }), makeGallery({ mediaGroupingID: 6 }));
    expect(mapper.getGalleryMappingByMediaGroupingID(5, 'source')).not.toBeNull();
  });

  it('returns mapping by target mediaGroupingID', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeGallery({ mediaGroupingID: 5 }), makeGallery({ mediaGroupingID: 6 }));
    expect(mapper.getGalleryMappingByMediaGroupingID(6, 'target')).not.toBeNull();
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe('GalleryMapper.addMapping', () => {
  it('adds a new mapping', () => {
    const mapper = makeMapper();
    mapper.addMapping(makeGallery({ mediaGroupingID: 10 }), makeGallery({ mediaGroupingID: 20 }));
    expect(mapper.getGalleryMappingByMediaGroupingID(20, 'target')).not.toBeNull();
  });

  it('updates existing mapping when target already exists', () => {
    const mapper = makeMapper();
    const tgt = makeGallery({ mediaGroupingID: 20 });
    mapper.addMapping(makeGallery({ mediaGroupingID: 10, modifiedOn: '01/01/2024 10:00AM' }), tgt);
    mapper.addMapping(makeGallery({ mediaGroupingID: 11, modifiedOn: '02/01/2024 10:00AM' }), tgt);
    const found = mapper.getGalleryMappingByMediaGroupingID(20, 'target')!;
    expect(found.sourceMediaGroupingID).toBe(11);
  });
});

// ─── hasSourceChanged ─────────────────────────────────────────────────────────

describe('GalleryMapper.hasSourceChanged', () => {
  it('returns false when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(makeGallery({ mediaGroupingID: 999 }))).toBe(false);
  });

  it('returns false when modifiedOn has not changed', () => {
    const mapper = makeMapper();
    const date = '03/15/2024 02:00PM';
    const src = makeGallery({ mediaGroupingID: 10, modifiedOn: date });
    mapper.addMapping(src, makeGallery({ mediaGroupingID: 20 }));
    expect(mapper.hasSourceChanged(makeGallery({ mediaGroupingID: 10, modifiedOn: date }))).toBe(false);
  });

  it('returns true when source date is newer than mapped date', () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeGallery({ mediaGroupingID: 10, modifiedOn: '01/01/2024 10:00AM' }),
      makeGallery({ mediaGroupingID: 20 }),
    );
    expect(
      mapper.hasSourceChanged(makeGallery({ mediaGroupingID: 10, modifiedOn: '06/01/2025 10:00AM' }))
    ).toBe(true);
  });
});

// ─── hasTargetChanged ─────────────────────────────────────────────────────────

describe('GalleryMapper.hasTargetChanged', () => {
  it('returns false when targetGallery is null/falsy', () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(null as any)).toBe(false);
  });

  it('returns false when no mapping exists', () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(makeGallery({ mediaGroupingID: 999 }))).toBe(false);
  });

  it('returns false when modifiedOn has not changed', () => {
    const mapper = makeMapper();
    const date = '04/10/2024 09:00AM';
    mapper.addMapping(
      makeGallery({ mediaGroupingID: 10 }),
      makeGallery({ mediaGroupingID: 20, modifiedOn: date }),
    );
    expect(mapper.hasTargetChanged(makeGallery({ mediaGroupingID: 20, modifiedOn: date }))).toBe(false);
  });

  it('returns true when target date is newer than mapped date', () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeGallery({ mediaGroupingID: 10 }),
      makeGallery({ mediaGroupingID: 20, modifiedOn: '01/01/2024 10:00AM' }),
    );
    expect(
      mapper.hasTargetChanged(makeGallery({ mediaGroupingID: 20, modifiedOn: '12/31/2025 11:59PM' }))
    ).toBe(true);
  });
});
