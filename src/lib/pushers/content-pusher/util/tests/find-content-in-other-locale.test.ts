import { resetState, setState } from 'core/state';
import { state } from 'core/state';

// Mock ContentItemMapper to avoid filesystem calls
jest.mock('lib/mappers/content-item-mapper', () => {
  const mockGetMapping = jest.fn();
  return {
    ContentItemMapper: jest.fn().mockImplementation(() => ({
      getContentItemMappingByContentID: mockGetMapping,
    })),
    __mockGetMapping: mockGetMapping,
  };
});

// Mock PageMapper (imported but not used in the function under test)
jest.mock('lib/mappers/page-mapper', () => ({
  PageMapper: jest.fn(),
}));

import { findContentInOtherLocale } from '../find-content-in-other-locale';
import { ContentItemMapper } from 'lib/mappers/content-item-mapper';

const mockModule = jest.requireMock('lib/mappers/content-item-mapper') as any;

beforeEach(() => {
  resetState();
  mockModule.__mockGetMapping.mockReset();
  (ContentItemMapper as jest.Mock).mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  sourceGuid: 'src-guid',
  targetGuid: 'tgt-guid',
  sourceContentID: 42,
  locale: 'en-us',
};

// ─── no available locales ─────────────────────────────────────────────────────

describe('findContentInOtherLocale — no available locales', () => {
  it('returns -1 when availableLocales is empty', async () => {
    state.availableLocales = [];
    const result = await findContentInOtherLocale(BASE_PROPS);
    expect(result).toBe(-1);
    expect(ContentItemMapper).not.toHaveBeenCalled();
  });

  it('returns -1 when availableLocales only contains the current locale', async () => {
    state.availableLocales = ['en-us'];
    const result = await findContentInOtherLocale(BASE_PROPS);
    expect(result).toBe(-1);
    expect(ContentItemMapper).not.toHaveBeenCalled();
  });
});

// ─── mapping found in another locale ─────────────────────────────────────────

describe('findContentInOtherLocale — mapping found', () => {
  it('returns targetContentID from the mapping when found in another locale', async () => {
    state.availableLocales = ['en-us', 'fr-ca'];
    mockModule.__mockGetMapping.mockReturnValue({
      sourceContentID: 42,
      targetContentID: 999,
    });
    const result = await findContentInOtherLocale(BASE_PROPS);
    expect(result).toBe(999);
  });

  it('creates ContentItemMapper with the other locale (not the current one)', async () => {
    state.availableLocales = ['en-us', 'fr-ca'];
    mockModule.__mockGetMapping.mockReturnValue({ sourceContentID: 42, targetContentID: 999 });
    await findContentInOtherLocale(BASE_PROPS);
    expect(ContentItemMapper).toHaveBeenCalledWith('src-guid', 'tgt-guid', 'fr-ca');
  });

  it('checks the mapper with source type and the given contentID', async () => {
    state.availableLocales = ['en-us', 'de-de'];
    mockModule.__mockGetMapping.mockReturnValue({ sourceContentID: 42, targetContentID: 200 });
    await findContentInOtherLocale(BASE_PROPS);
    expect(mockModule.__mockGetMapping).toHaveBeenCalledWith(42, 'source');
  });
});

// ─── no mapping found ─────────────────────────────────────────────────────────

describe('findContentInOtherLocale — no mapping found', () => {
  it('returns -1 when no other locale has a mapping', async () => {
    state.availableLocales = ['en-us', 'fr-ca', 'de-de'];
    mockModule.__mockGetMapping.mockReturnValue(null);
    const result = await findContentInOtherLocale(BASE_PROPS);
    expect(result).toBe(-1);
  });

  it('checks every other locale before returning -1', async () => {
    state.availableLocales = ['en-us', 'fr-ca', 'de-de'];
    mockModule.__mockGetMapping.mockReturnValue(null);
    await findContentInOtherLocale(BASE_PROPS);
    // Two other locales checked (fr-ca, de-de)
    expect(ContentItemMapper).toHaveBeenCalledTimes(2);
  });
});

// ─── stops early when found ───────────────────────────────────────────────────

describe('findContentInOtherLocale — early exit', () => {
  it('returns as soon as a mapping is found and does not check subsequent locales', async () => {
    state.availableLocales = ['en-us', 'fr-ca', 'de-de'];
    // Only fr-ca has the mapping
    mockModule.__mockGetMapping.mockReturnValueOnce({ sourceContentID: 42, targetContentID: 555 });
    const result = await findContentInOtherLocale(BASE_PROPS);
    expect(result).toBe(555);
    // Should have stopped after first match
    expect(ContentItemMapper).toHaveBeenCalledTimes(1);
  });
});

// ─── mapper error handling ────────────────────────────────────────────────────

describe('findContentInOtherLocale — mapper throws', () => {
  it('catches errors from getContentItemMappingByContentID and continues', async () => {
    state.availableLocales = ['en-us', 'fr-ca', 'de-de'];
    mockModule.__mockGetMapping
      .mockImplementationOnce(() => { throw new Error('file not found'); })
      .mockReturnValueOnce({ sourceContentID: 42, targetContentID: 777 });
    const result = await findContentInOtherLocale(BASE_PROPS);
    expect(result).toBe(777);
  });
});
