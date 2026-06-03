import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import {
  readMappingsForGuidPair,
  listAvailableMappingPairs,
  getMappingSummary,
} from 'lib/mappers/mapping-reader';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-mapping-reader-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const LOCALE = 'en-us';
let testCounter = 0;
let SRC: string;
let TGT: string;

beforeEach(() => {
  // Fresh GUID pair per test prevents mapping file pollution across tests
  testCounter++;
  SRC = `src-${testCounter}`;
  TGT = `tgt-${testCounter}`;

  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function writeMappingFile(type: string, data: any[], locale?: string): void {
  const localeSegment = locale ?? '';
  const dir = path.join(tmpDir, 'mappings', `${SRC}-${TGT}`, localeSegment, type);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mappings.json'), JSON.stringify(data));
}

// ─── readMappingsForGuidPair ──────────────────────────────────────────────────

describe('readMappingsForGuidPair', () => {
  it('returns empty arrays when no mapping files exist for this GUID pair', () => {
    const result = readMappingsForGuidPair(SRC, TGT, [LOCALE]);
    expect(result.contentIds).toEqual([]);
    expect(result.pageIds).toEqual([]);
    expect(result.contentMappings).toEqual([]);
    expect(result.pageMappings).toEqual([]);
  });

  it('reads content mappings and extracts targetContentIDs', () => {
    const mappings = [
      { sourceGuid: SRC, targetGuid: TGT, sourceContentID: 1, targetContentID: 101, sourceVersionID: 1, targetVersionID: 2 },
      { sourceGuid: SRC, targetGuid: TGT, sourceContentID: 2, targetContentID: 102, sourceVersionID: 1, targetVersionID: 2 },
    ];
    writeMappingFile('item', mappings, LOCALE);
    const result = readMappingsForGuidPair(SRC, TGT, [LOCALE]);
    expect(result.contentIds).toContain(101);
    expect(result.contentIds).toContain(102);
    expect(result.contentMappings).toHaveLength(2);
  });

  it('reads page mappings and extracts targetPageIDs', () => {
    const pageMappings = [
      { sourceGuid: SRC, targetGuid: TGT, sourcePageID: 10, targetPageID: 110, sourceVersionID: 1, targetVersionID: 1, sourcePageTemplateName: 'T', targetPageTemplateName: 'T' },
    ];
    writeMappingFile('page', pageMappings, LOCALE);
    const result = readMappingsForGuidPair(SRC, TGT, [LOCALE]);
    expect(result.pageIds).toContain(110);
    expect(result.pageMappings).toHaveLength(1);
  });

  it('deduplicates IDs that appear across multiple locales', () => {
    const mappings = [
      { sourceGuid: SRC, targetGuid: TGT, sourceContentID: 1, targetContentID: 101, sourceVersionID: 1, targetVersionID: 1 },
    ];
    writeMappingFile('item', mappings, 'en-us');
    writeMappingFile('item', mappings, 'fr-ca');
    const result = readMappingsForGuidPair(SRC, TGT, ['en-us', 'fr-ca']);
    // 101 appears in both locales but should be deduplicated
    expect(result.contentIds.filter((id) => id === 101)).toHaveLength(1);
  });

  it('returns empty results when locales array is empty', () => {
    const result = readMappingsForGuidPair(SRC, TGT, []);
    expect(result.contentIds).toEqual([]);
    expect(result.pageIds).toEqual([]);
  });
});

// ─── listAvailableMappingPairs ────────────────────────────────────────────────

describe('listAvailableMappingPairs', () => {
  it('returns empty array when mappings root does not exist', () => {
    // Use a fresh isolated tmpDir so we are certain there are no pre-existing mapping dirs
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-reader-iso-'));
    try {
      setState({ rootPath: isolatedDir });
      const result = listAvailableMappingPairs();
      expect(result).toEqual([]);
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it('returns pairs that have locale subdirectories', () => {
    const pairDir = path.join(tmpDir, 'mappings', `${SRC}-${TGT}`);
    fs.mkdirSync(path.join(pairDir, 'en-us'), { recursive: true });
    const result = listAvailableMappingPairs();
    const pair = result.find((p) => p.sourceGuid === SRC && p.targetGuid === TGT);
    expect(pair).toBeDefined();
    expect(pair!.locales).toContain('en-us');
  });

  it('skips directories that do not match the GUID pair format', () => {
    const invalidDir = path.join(tmpDir, 'mappings', 'not-valid-format-xyz');
    fs.mkdirSync(path.join(invalidDir, 'en-us'), { recursive: true });
    const result = listAvailableMappingPairs();
    const found = result.find((p) => p.sourceGuid === 'not' && p.targetGuid === 'valid');
    expect(found).toBeUndefined();
  });
});

// ─── getMappingSummary ────────────────────────────────────────────────────────

describe('getMappingSummary', () => {
  it('returns zero totals when no mapping files exist for this GUID pair', () => {
    const summary = getMappingSummary(SRC, TGT, [LOCALE]);
    expect(summary.totalContent).toBe(0);
    expect(summary.totalPages).toBe(0);
  });

  it('returns correct totalContent count', () => {
    writeMappingFile('item', [
      { sourceGuid: SRC, targetGuid: TGT, sourceContentID: 50, targetContentID: 150, sourceVersionID: 1, targetVersionID: 1 },
      { sourceGuid: SRC, targetGuid: TGT, sourceContentID: 51, targetContentID: 151, sourceVersionID: 1, targetVersionID: 1 },
    ], LOCALE);
    const summary = getMappingSummary(SRC, TGT, [LOCALE]);
    expect(summary.totalContent).toBe(2);
  });

  it('includes locale in localesFound when it has content mappings', () => {
    writeMappingFile('item', [
      { sourceGuid: SRC, targetGuid: TGT, sourceContentID: 70, targetContentID: 170, sourceVersionID: 1, targetVersionID: 1 },
    ], LOCALE);
    const summary = getMappingSummary(SRC, TGT, [LOCALE]);
    expect(summary.localesFound).toContain(LOCALE);
  });

  it('does not include locale in localesFound when it has no mappings', () => {
    const summary = getMappingSummary(SRC, TGT, ['de-de']);
    expect(summary.localesFound).not.toContain('de-de');
  });
});
