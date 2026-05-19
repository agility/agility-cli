import { resetState, setState } from 'core/state';
import { changeDetection } from '../change-detection';
import type { ContentItemMapping } from 'lib/mappers/content-item-mapper';

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

function makeContent(id: number, versionID = 0, referenceName = `ref-${id}`): any {
  return {
    contentID: id,
    properties: { referenceName, versionID, definitionName: 'Model' },
    fields: {},
  };
}

function makeMapping(overrides: Partial<ContentItemMapping> = {}): ContentItemMapping {
  return {
    sourceGuid: 'src-guid',
    targetGuid: 'tgt-guid',
    sourceContentID: 1,
    targetContentID: 100,
    sourceVersionID: 1,
    targetVersionID: 1,
    ...overrides,
  };
}

// ─── invalid source entity ────────────────────────────────────────────────────

describe('changeDetection — invalid source entity', () => {
  it('returns shouldSkip=true when source is null', () => {
    const result = changeDetection(null as any, null, null as any, 'en-us');
    expect(result.shouldSkip).toBe(true);
    expect(result.shouldCreate).toBe(false);
    expect(result.shouldUpdate).toBe(false);
    expect(result.isConflict).toBe(false);
  });

  it('returns shouldSkip=true when source has no properties', () => {
    const result = changeDetection({} as any, null, null as any, 'en-us');
    expect(result.shouldSkip).toBe(true);
  });
});

// ─── create path ──────────────────────────────────────────────────────────────

describe('changeDetection — create path', () => {
  it('returns shouldCreate=true when no mapping and no target', () => {
    const source = makeContent(1, 5);
    const result = changeDetection(source, null, null as any, 'en-us');
    expect(result.shouldCreate).toBe(true);
    expect(result.shouldUpdate).toBe(false);
    expect(result.shouldSkip).toBe(false);
    expect(result.isConflict).toBe(false);
    expect(result.entity).toBeNull();
  });
});

// ─── conflict path ────────────────────────────────────────────────────────────

describe('changeDetection — conflict path', () => {
  it('returns isConflict=true when both source and target versions exceed mapped versions', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 10);
    const target = makeContent(100, 10);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.isConflict).toBe(true);
    expect(result.shouldUpdate).toBe(false);
    expect(result.shouldCreate).toBe(false);
    expect(result.shouldSkip).toBe(false);
    expect(result.entity).toBe(target);
  });

  it('conflict reason contains source and target URLs', () => {
    setState({ sourceGuid: 'src-g', targetGuid: 'tgt-g' });
    const source = makeContent(1, 10);
    const target = makeContent(100, 10);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.reason).toContain('src-g');
    expect(result.reason).toContain('tgt-g');
    expect(result.reason).toContain('1');
    expect(result.reason).toContain('100');
  });

  it('does NOT conflict when only source version increased', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 10);
    const target = makeContent(100, 5);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.isConflict).toBe(false);
  });

  it('does NOT conflict when only target version increased', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 5);
    const target = makeContent(100, 10);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.isConflict).toBe(false);
  });
});

// ─── update path ──────────────────────────────────────────────────────────────

describe('changeDetection — update path', () => {
  it('returns shouldUpdate=true when source version > mapped source version and target is unchanged', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 10);
    const target = makeContent(100, 5);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.shouldUpdate).toBe(true);
    expect(result.shouldCreate).toBe(false);
    expect(result.shouldSkip).toBe(false);
    expect(result.isConflict).toBe(false);
    expect(result.entity).toBe(target);
  });

  it('returns shouldUpdate=true when source version > mapped and target version <= mapped', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 20);
    const target = makeContent(100, 3);
    const mapping = makeMapping({ sourceVersionID: 10, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.shouldUpdate).toBe(true);
  });
});

// ─── overwrite mode ───────────────────────────────────────────────────────────

describe('changeDetection — overwrite mode', () => {
  it('returns shouldUpdate=true in overwrite mode even when source is not newer', () => {
    setState({ overwrite: true, sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 5);
    const target = makeContent(100, 5);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.shouldUpdate).toBe(true);
    expect(result.shouldSkip).toBe(false);
    expect(result.reason).toMatch(/overwrite/i);
  });

  it('uses overwrite fallback only when not a conflict', () => {
    setState({ overwrite: true, sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 10);
    const target = makeContent(100, 10);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    // conflict takes precedence over overwrite
    expect(result.isConflict).toBe(true);
  });
});

// ─── skip path ────────────────────────────────────────────────────────────────

describe('changeDetection — skip path', () => {
  it('returns shouldSkip=true when source version equals mapped version and overwrite is false', () => {
    setState({ overwrite: false, sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 5);
    const target = makeContent(100, 5);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.shouldSkip).toBe(true);
    expect(result.shouldUpdate).toBe(false);
    expect(result.shouldCreate).toBe(false);
    expect(result.isConflict).toBe(false);
    expect(result.entity).toBe(target);
  });

  it('returns shouldSkip=true when source version is less than mapped version', () => {
    setState({ overwrite: false });
    const source = makeContent(1, 3);
    const target = makeContent(100, 5);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.shouldSkip).toBe(true);
  });
});

// ─── zero-version edge cases ──────────────────────────────────────────────────

describe('changeDetection — zero-version edge cases', () => {
  it('does not enter conflict branch when versions are 0', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source = makeContent(1, 0);
    const target = makeContent(100, 0);
    const mapping = makeMapping({ sourceVersionID: 0, targetVersionID: 0 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.isConflict).toBe(false);
  });

  it('falls through to skip when both source and target version are 0 and overwrite is false', () => {
    setState({ overwrite: false });
    const source = makeContent(1, 0);
    const target = makeContent(100, 0);
    const mapping = makeMapping({ sourceVersionID: 0, targetVersionID: 0 });
    const result = changeDetection(source, target, mapping, 'en-us');
    expect(result.shouldSkip).toBe(true);
  });
});

// ─── referenceName fallback ───────────────────────────────────────────────────

describe('changeDetection — referenceName fallback', () => {
  it('uses contentID in itemName when referenceName is absent', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const source: any = {
      contentID: 42,
      properties: { versionID: 10 },
      fields: {},
    };
    const target = makeContent(100, 10);
    const mapping = makeMapping({ sourceVersionID: 5, targetVersionID: 5 });
    expect(() => changeDetection(source, target, mapping, 'en-us')).not.toThrow();
  });
});
