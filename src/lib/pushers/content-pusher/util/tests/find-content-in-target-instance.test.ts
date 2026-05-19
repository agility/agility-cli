import { resetState, setState } from 'core/state';
import { findContentInTargetInstance } from '../find-content-in-target-instance';

jest.mock('lib/mappers/content-item-mapper', () => ({
  ContentItemMapper: jest.fn(),
}));

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

function makeMapper(opts: {
  mapping?: any;
  targetEntity?: any;
  locale?: string;
} = {}): any {
  return {
    getContentItemMappingByContentID: jest.fn().mockReturnValue(opts.mapping ?? null),
    getMappedEntity: jest.fn().mockReturnValue(opts.targetEntity ?? null),
    locale: opts.locale ?? 'en-us',
  };
}

// ─── no mapping exists ────────────────────────────────────────────────────────

describe('findContentInTargetInstance — no mapping', () => {
  it('returns shouldCreate=true when no mapping and no target entity', () => {
    const source = makeContent(1, 5);
    const mapper = makeMapper({ mapping: null, targetEntity: null });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(result.shouldCreate).toBe(true);
    expect(result.shouldUpdate).toBe(false);
    expect(result.shouldSkip).toBe(false);
    expect(result.isConflict).toBe(false);
  });

  it('does not call getMappedEntity when no mapping exists', () => {
    const source = makeContent(1, 5);
    const mapper = makeMapper({ mapping: null });
    findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(mapper.getMappedEntity).not.toHaveBeenCalled();
  });
});

// ─── mapping exists, target entity found ─────────────────────────────────────

describe('findContentInTargetInstance — mapping and target entity exist', () => {
  it('returns shouldSkip=true when source and target versions are unchanged', () => {
    setState({ overwrite: false, sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const mapping = {
      sourceGuid: 'src-guid',
      targetGuid: 'tgt-guid',
      sourceContentID: 1,
      targetContentID: 100,
      sourceVersionID: 5,
      targetVersionID: 5,
    };
    const source = makeContent(1, 5);
    const target = makeContent(100, 5);
    const mapper = makeMapper({ mapping, targetEntity: target });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(result.shouldSkip).toBe(true);
    expect(result.content).toBe(target);
  });

  it('returns shouldUpdate=true when source version is newer than mapped', () => {
    setState({ overwrite: false, sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const mapping = {
      sourceGuid: 'src-guid',
      targetGuid: 'tgt-guid',
      sourceContentID: 1,
      targetContentID: 100,
      sourceVersionID: 3,
      targetVersionID: 5,
    };
    const source = makeContent(1, 10);
    const target = makeContent(100, 5);
    const mapper = makeMapper({ mapping, targetEntity: target });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(result.shouldUpdate).toBe(true);
  });

  it('calls getMappedEntity with the mapping and "target" type', () => {
    const mapping = {
      sourceGuid: 'src-guid',
      targetGuid: 'tgt-guid',
      sourceContentID: 1,
      targetContentID: 100,
      sourceVersionID: 5,
      targetVersionID: 5,
    };
    const source = makeContent(1, 5);
    const target = makeContent(100, 5);
    const mapper = makeMapper({ mapping, targetEntity: target });
    findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(mapper.getMappedEntity).toHaveBeenCalledWith(mapping, 'target');
  });
});

// ─── mapping exists but target entity is missing ─────────────────────────────

describe('findContentInTargetInstance — mapping exists, target entity missing', () => {
  it('treats missing target entity as null when running changeDetection', () => {
    setState({ overwrite: false });
    const mapping = {
      sourceGuid: 'src-guid',
      targetGuid: 'tgt-guid',
      sourceContentID: 1,
      targetContentID: 100,
      sourceVersionID: 5,
      targetVersionID: 5,
    };
    const source = makeContent(1, 5);
    const mapper = makeMapper({ mapping, targetEntity: null });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    // changeDetection receives (source, null, mapping, locale)
    // sourceVersion=5, targetVersion=0 → sourceVersion > mappedSourceVersion? No (5 == 5).
    // Falls through to skip.
    expect(result.shouldSkip).toBe(true);
  });
});

// ─── conflict detection ───────────────────────────────────────────────────────

describe('findContentInTargetInstance — conflict detection', () => {
  it('returns isConflict=true when both source and target versions changed', () => {
    setState({ sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const mapping = {
      sourceGuid: 'src-guid',
      targetGuid: 'tgt-guid',
      sourceContentID: 1,
      targetContentID: 100,
      sourceVersionID: 5,
      targetVersionID: 5,
    };
    const source = makeContent(1, 10);
    const target = makeContent(100, 10);
    const mapper = makeMapper({ mapping, targetEntity: target });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(result.isConflict).toBe(true);
  });
});

// ─── overwrite mode ───────────────────────────────────────────────────────────

describe('findContentInTargetInstance — overwrite mode', () => {
  it('returns shouldUpdate=true in overwrite mode for up-to-date items', () => {
    setState({ overwrite: true, sourceGuid: 'src-guid', targetGuid: 'tgt-guid' });
    const mapping = {
      sourceGuid: 'src-guid',
      targetGuid: 'tgt-guid',
      sourceContentID: 1,
      targetContentID: 100,
      sourceVersionID: 5,
      targetVersionID: 5,
    };
    const source = makeContent(1, 5);
    const target = makeContent(100, 5);
    const mapper = makeMapper({ mapping, targetEntity: target });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(result.shouldUpdate).toBe(true);
  });
});

// ─── result shape ─────────────────────────────────────────────────────────────

describe('findContentInTargetInstance — result shape', () => {
  it('always returns all required fields', () => {
    const source = makeContent(1, 5);
    const mapper = makeMapper({ mapping: null, targetEntity: null });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('shouldUpdate');
    expect(result).toHaveProperty('shouldCreate');
    expect(result).toHaveProperty('shouldSkip');
    expect(result).toHaveProperty('isConflict');
    expect(result).toHaveProperty('decision');
  });

  it('content is null when entity is null in decision', () => {
    const source = makeContent(1, 5);
    const mapper = makeMapper({ mapping: null, targetEntity: null });
    const result = findContentInTargetInstance({ sourceContent: source, referenceMapper: mapper });
    expect(result.content).toBeNull();
  });
});
