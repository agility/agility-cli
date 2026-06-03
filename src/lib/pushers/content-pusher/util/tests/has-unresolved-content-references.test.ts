import { resetState } from 'core/state';
import { hasUnresolvedContentReferences } from '../has-unresolved-content-references';

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

function makeMapper(resolved: boolean): any {
  return {
    getContentItemMappingByContentID: jest.fn().mockReturnValue(
      resolved ? { sourceContentID: 1, targetContentID: 100 } : null
    ),
  };
}

function makePartialMapper(resolvedIds: number[]): any {
  return {
    getContentItemMappingByContentID: jest.fn().mockImplementation(
      (id: number) =>
        resolvedIds.includes(id) ? { sourceContentID: id, targetContentID: id + 1000 } : null
    ),
  };
}

// ─── non-object primitives ────────────────────────────────────────────────────

describe('hasUnresolvedContentReferences — non-object primitives', () => {
  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['a number', 42],
    ['true', true],
    ['undefined', undefined],
  ])('returns false for %s', (_label, value) => {
    expect(hasUnresolvedContentReferences(value, makeMapper(true))).toBe(false);
  });
});

// ─── contentid (lowercase) ────────────────────────────────────────────────────

describe('hasUnresolvedContentReferences — contentid key', () => {
  it('returns false when contentid is resolved in mapper', () => {
    const mapper = makeMapper(true);
    expect(hasUnresolvedContentReferences({ contentid: 5 }, mapper)).toBe(false);
    expect(mapper.getContentItemMappingByContentID).toHaveBeenCalledWith(5, 'source');
  });

  it('returns true when contentid is not found in mapper', () => {
    const mapper = makeMapper(false);
    expect(hasUnresolvedContentReferences({ contentid: 5 }, mapper)).toBe(true);
  });

  it('ignores contentid when value is a string (not a number)', () => {
    const mapper = makeMapper(false);
    expect(hasUnresolvedContentReferences({ contentid: 'abc' }, mapper)).toBe(false);
    expect(mapper.getContentItemMappingByContentID).not.toHaveBeenCalled();
  });
});

// ─── contentID (camelCase) ────────────────────────────────────────────────────

describe('hasUnresolvedContentReferences — contentID key', () => {
  it('returns false when contentID is resolved', () => {
    const mapper = makeMapper(true);
    expect(hasUnresolvedContentReferences({ contentID: 99 }, mapper)).toBe(false);
  });

  it('returns true when contentID is unresolved', () => {
    const mapper = makeMapper(false);
    expect(hasUnresolvedContentReferences({ contentID: 99 }, mapper)).toBe(true);
  });

  it('ignores string contentID values', () => {
    const mapper = makeMapper(false);
    expect(hasUnresolvedContentReferences({ contentID: 'not-a-number' }, mapper)).toBe(false);
  });
});

// ─── sortids ─────────────────────────────────────────────────────────────────

describe('hasUnresolvedContentReferences — sortids key', () => {
  it('returns false when all sortids are resolved', () => {
    const mapper = makePartialMapper([1, 2, 3]);
    expect(hasUnresolvedContentReferences({ sortids: '1,2,3' }, mapper)).toBe(false);
  });

  it('returns true when at least one sortid is unresolved', () => {
    const mapper = makePartialMapper([1, 3]);
    expect(hasUnresolvedContentReferences({ sortids: '1,2,3' }, mapper)).toBe(true);
  });

  it('ignores blank entries in sortids', () => {
    const mapper = makePartialMapper([1, 2]);
    expect(hasUnresolvedContentReferences({ sortids: '1,,2,' }, mapper)).toBe(false);
  });

  it('skips NaN entries in sortids', () => {
    const mapper = makePartialMapper([]);
    expect(hasUnresolvedContentReferences({ sortids: 'abc,def' }, mapper)).toBe(false);
    expect(mapper.getContentItemMappingByContentID).not.toHaveBeenCalled();
  });

  it('handles empty sortids string', () => {
    const mapper = makeMapper(false);
    expect(hasUnresolvedContentReferences({ sortids: '' }, mapper)).toBe(false);
  });
});

// ─── nested objects ───────────────────────────────────────────────────────────

describe('hasUnresolvedContentReferences — nested objects', () => {
  it('returns true when an unresolved contentid is buried in a nested object', () => {
    const mapper = makeMapper(false);
    const obj = { outer: { inner: { contentid: 10 } } };
    expect(hasUnresolvedContentReferences(obj, mapper)).toBe(true);
  });

  it('returns false when all nested contentids are resolved', () => {
    const mapper = makeMapper(true);
    const obj = { outer: { inner: { contentid: 10 } } };
    expect(hasUnresolvedContentReferences(obj, mapper)).toBe(false);
  });
});

// ─── arrays ──────────────────────────────────────────────────────────────────

describe('hasUnresolvedContentReferences — arrays', () => {
  it('returns true when any array element has an unresolved reference', () => {
    const mapper = makePartialMapper([1]);
    const arr = [{ contentid: 1 }, { contentid: 99 }];
    expect(hasUnresolvedContentReferences(arr, mapper)).toBe(true);
  });

  it('returns false when all array elements are resolved', () => {
    const mapper = makePartialMapper([1, 2]);
    const arr = [{ contentid: 1 }, { contentid: 2 }];
    expect(hasUnresolvedContentReferences(arr, mapper)).toBe(false);
  });

  it('returns false for an empty array', () => {
    const mapper = makeMapper(false);
    expect(hasUnresolvedContentReferences([], mapper)).toBe(false);
  });
});

// ─── combination cases ────────────────────────────────────────────────────────

describe('hasUnresolvedContentReferences — combination cases', () => {
  it('returns false when object has unrelated keys only', () => {
    const mapper = makeMapper(false);
    expect(hasUnresolvedContentReferences({ title: 'Hello', count: 5 }, mapper)).toBe(false);
    expect(mapper.getContentItemMappingByContentID).not.toHaveBeenCalled();
  });

  it('early-exits on first unresolved reference (does not scan the rest)', () => {
    const mapper = makeMapper(false);
    const obj = { contentid: 1, sortids: '2,3', nested: { contentID: 4 } };
    const result = hasUnresolvedContentReferences(obj, mapper);
    expect(result).toBe(true);
    expect(mapper.getContentItemMappingByContentID).toHaveBeenCalledTimes(1);
  });
});
