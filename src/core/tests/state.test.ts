import {
  setState,
  resetState,
  getState,
  validateLocaleFormat,
  validateLocales,
  getUIMode,
  getCmsAppUrl,
  getPageCmsLink,
  getContentCmsLink,
  getApiKeysForGuid,
  getAllApiKeys,
  registerFailedContent,
  getFailedContent,
  clearFailedContentRegistry,
  initializeLogger,
  initializeGuidLogger,
  getLoggerForGuid,
} from '../state';

beforeEach(() => {
  resetState();
});

// ─── setState ────────────────────────────────────────────────────────────────

describe('setState – GUID parsing', () => {
  it('sets a single sourceGuid', () => {
    setState({ sourceGuid: 'abc123u' });
    expect(getState().sourceGuid).toEqual(['abc123u']);
  });

  it('splits comma-separated sourceGuids into an array', () => {
    setState({ sourceGuid: 'guid1u,guid2u, guid3u' });
    expect(getState().sourceGuid).toEqual(['guid1u', 'guid2u', 'guid3u']);
  });

  it('sets a single targetGuid', () => {
    setState({ targetGuid: 'xyz789u' });
    expect(getState().targetGuid).toEqual(['xyz789u']);
  });

  it('splits comma-separated targetGuids', () => {
    setState({ targetGuid: 'a1u,b2u' });
    expect(getState().targetGuid).toEqual(['a1u', 'b2u']);
  });

  it('ignores empty segments in comma-separated GUIDs', () => {
    setState({ sourceGuid: 'a1u,,b2u,' });
    expect(getState().sourceGuid).toEqual(['a1u', 'b2u']);
  });
});

describe('setState – locale parsing', () => {
  it('sets a single locale', () => {
    setState({ locale: 'en-us' });
    expect(getState().locale).toEqual(['en-us']);
  });

  it('splits comma-separated locales', () => {
    setState({ locale: 'en-us,fr-ca' });
    expect(getState().locale).toEqual(['en-us', 'fr-ca']);
  });

  it('splits space-separated locales', () => {
    setState({ locale: 'en-us fr-ca' });
    expect(getState().locale).toEqual(['en-us', 'fr-ca']);
  });

  it('sets empty array for blank locale string', () => {
    setState({ locale: '  ' });
    expect(getState().locale).toEqual([]);
  });
});

describe('setState – explicit ID parsing', () => {
  it('parses comma-separated contentIDs into numbers', () => {
    setState({ contentIDs: '1,2,3' });
    expect(getState().explicitContentIDs).toEqual([1, 2, 3]);
  });

  it('parses comma-separated pageIDs into numbers', () => {
    setState({ pageIDs: '10, 20, 30' });
    expect(getState().explicitPageIDs).toEqual([10, 20, 30]);
  });

  it('filters out NaN and non-positive IDs', () => {
    setState({ contentIDs: '1,abc,-5,0,99' });
    expect(getState().explicitContentIDs).toEqual([1, 99]);
  });

  it('accepts direct array assignment for explicitContentIDs', () => {
    setState({ explicitContentIDs: [5, 10, 15] });
    expect(getState().explicitContentIDs).toEqual([5, 10, 15]);
  });

  it('accepts direct array assignment for explicitPageIDs', () => {
    setState({ explicitPageIDs: [100, 200] });
    expect(getState().explicitPageIDs).toEqual([100, 200]);
  });
});

describe('setState – boolean and string flags', () => {
  it('sets headless flag', () => {
    setState({ headless: true });
    expect(getState().headless).toBe(true);
  });

  it('sets verbose flag', () => {
    setState({ verbose: true });
    expect(getState().verbose).toBe(true);
  });

  it('sets overwrite flag', () => {
    setState({ overwrite: true });
    expect(getState().overwrite).toBe(true);
  });

  it('sets force flag', () => {
    setState({ force: true });
    expect(getState().force).toBe(true);
  });

  it('sets dryRun flag', () => {
    setState({ dryRun: true });
    expect(getState().dryRun).toBe(true);
  });

  it('sets autoPublish value', () => {
    setState({ autoPublish: 'both' });
    expect(getState().autoPublish).toBe('both');
  });

  it('sets rootPath', () => {
    setState({ rootPath: '/custom/path' });
    expect(getState().rootPath).toBe('/custom/path');
  });

  it('sets operationType', () => {
    setState({ operationType: 'publish' });
    expect(getState().operationType).toBe('publish');
  });

  it('sets token', () => {
    setState({ token: 'my-pat-token' });
    expect(getState().token).toBe('my-pat-token');
  });

  it('ignores undefined values (does not overwrite existing state)', () => {
    setState({ headless: true });
    setState({ verbose: true }); // headless should still be true
    expect(getState().headless).toBe(true);
  });
});

// ─── resetState ──────────────────────────────────────────────────────────────

describe('resetState', () => {
  it('clears sourceGuid and targetGuid', () => {
    setState({ sourceGuid: 'abc', targetGuid: 'xyz' });
    resetState();
    expect(getState().sourceGuid).toEqual([]);
    expect(getState().targetGuid).toEqual([]);
  });

  it('resets boolean flags to defaults', () => {
    setState({ headless: true, verbose: true, overwrite: true, force: true, dryRun: true });
    resetState();
    const s = getState();
    expect(s.headless).toBe(false);
    expect(s.verbose).toBe(false);
    expect(s.overwrite).toBe(false);
    expect(s.force).toBe(false);
    expect(s.dryRun).toBe(false);
  });

  it('resets rootPath to agility-files', () => {
    setState({ rootPath: '/custom' });
    resetState();
    expect(getState().rootPath).toBe('agility-files');
  });

  it('resets token to null', () => {
    setState({ token: 'abc' });
    resetState();
    expect(getState().token).toBeNull();
  });

  it('resets explicitContentIDs and explicitPageIDs to empty arrays', () => {
    setState({ contentIDs: '1,2,3', pageIDs: '10' });
    resetState();
    expect(getState().explicitContentIDs).toEqual([]);
    expect(getState().explicitPageIDs).toEqual([]);
  });

  it('resets autoPublish to empty string', () => {
    setState({ autoPublish: 'both' });
    resetState();
    expect(getState().autoPublish).toBe('');
  });
});

// ─── validateLocaleFormat ─────────────────────────────────────────────────────

describe('validateLocaleFormat', () => {
  it.each([
    ['en-us'],
    ['fr-ca'],
    ['es-es'],
    ['EN-US'],
    ['Zh-CN'],
  ])('accepts valid locale %s', (locale) => {
    expect(validateLocaleFormat(locale)).toBe(true);
  });

  it.each([
    ['english'],
    ['en'],
    ['en-USA'],
    ['en_us'],
    ['e-us'],
    ['123-456'],
    [''],
    ['en-u'],
  ])('rejects invalid locale %s', (locale) => {
    expect(validateLocaleFormat(locale)).toBe(false);
  });
});

// ─── validateLocales ──────────────────────────────────────────────────────────

describe('validateLocales', () => {
  it('separates valid from invalid locales', () => {
    const result = validateLocales(['en-us', 'invalid', 'fr-ca', 'bad']);
    expect(result.valid).toEqual(['en-us', 'fr-ca']);
    expect(result.invalid).toEqual(['invalid', 'bad']);
  });

  it('returns all valid when all locales are correct', () => {
    const result = validateLocales(['en-us', 'fr-ca']);
    expect(result.valid).toEqual(['en-us', 'fr-ca']);
    expect(result.invalid).toEqual([]);
  });

  it('returns all invalid when all locales are wrong', () => {
    const result = validateLocales(['bad', 'nope']);
    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual(['bad', 'nope']);
  });

  it('handles empty array', () => {
    const result = validateLocales([]);
    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual([]);
  });
});

// ─── getUIMode ────────────────────────────────────────────────────────────────

describe('getUIMode', () => {
  it('returns useHeadless=false, useVerbose=false by default', () => {
    expect(getUIMode()).toEqual({ useHeadless: false, useVerbose: false });
  });

  it('returns useHeadless=true when headless is set', () => {
    setState({ headless: true });
    expect(getUIMode()).toEqual({ useHeadless: true, useVerbose: false });
  });

  it('returns useVerbose=true when verbose is set and not headless', () => {
    setState({ verbose: true });
    expect(getUIMode()).toEqual({ useHeadless: false, useVerbose: true });
  });

  it('headless takes priority over verbose', () => {
    setState({ headless: true, verbose: true });
    expect(getUIMode()).toEqual({ useHeadless: true, useVerbose: false });
  });
});

// ─── getCmsAppUrl ─────────────────────────────────────────────────────────────

describe('getCmsAppUrl', () => {
  it('returns prod URL by default', () => {
    expect(getCmsAppUrl()).toBe('https://app.agilitycms.com');
  });

  it('returns QA URL when dev=true', () => {
    setState({ dev: true });
    expect(getCmsAppUrl()).toBe('https://app-qa.publishwithagility.com');
  });

  it('returns QA URL when local=true', () => {
    setState({ local: true });
    expect(getCmsAppUrl()).toBe('https://app-qa.publishwithagility.com');
  });

  it('returns QA URL when preprod=true', () => {
    setState({ preprod: true });
    expect(getCmsAppUrl()).toBe('https://app-qa.publishwithagility.com');
  });
});

// ─── getPageCmsLink / getContentCmsLink ──────────────────────────────────────

describe('getPageCmsLink', () => {
  it('builds the correct prod page URL', () => {
    const url = getPageCmsLink('my-guid', 'en-us', 42);
    expect(url).toBe('https://app.agilitycms.com/instance/my-guid/en-us/pages/page-42');
  });

  it('builds the QA page URL in dev mode', () => {
    setState({ dev: true });
    const url = getPageCmsLink('my-guid', 'en-us', 42);
    expect(url).toBe('https://app-qa.publishwithagility.com/instance/my-guid/en-us/pages/page-42');
  });
});

describe('getContentCmsLink', () => {
  it('builds the correct prod content URL', () => {
    const url = getContentCmsLink('my-guid', 'en-us', 99);
    expect(url).toBe('https://app.agilitycms.com/instance/my-guid/en-us/content/item-0/listitem-99');
  });
});

// ─── API keys ────────────────────────────────────────────────────────────────

describe('getApiKeysForGuid / getAllApiKeys', () => {
  beforeEach(() => {
    getState().apiKeys = [
      { guid: 'guid-a', previewKey: 'prev-a', fetchKey: 'fetch-a' },
      { guid: 'guid-b', previewKey: 'prev-b', fetchKey: 'fetch-b' },
    ];
  });

  it('returns keys for a known GUID', () => {
    expect(getApiKeysForGuid('guid-a')).toEqual({ previewKey: 'prev-a', fetchKey: 'fetch-a' });
  });

  it('returns null for an unknown GUID', () => {
    expect(getApiKeysForGuid('unknown')).toBeNull();
  });

  it('getAllApiKeys returns all entries', () => {
    expect(getAllApiKeys()).toHaveLength(2);
  });
});

// ─── Failed content registry ─────────────────────────────────────────────────

describe('failed content registry', () => {
  it('registers and retrieves a failed content item', () => {
    registerFailedContent(123, 'my-ref', 'some error', 'en-us');
    const result = getFailedContent(123);
    expect(result).toEqual({ referenceName: 'my-ref', error: 'some error', locale: 'en-us' });
  });

  it('returns undefined for unknown content ID', () => {
    expect(getFailedContent(999)).toBeUndefined();
  });

  it('clears the registry', () => {
    registerFailedContent(1, 'ref', 'err', 'en-us');
    clearFailedContentRegistry();
    expect(getFailedContent(1)).toBeUndefined();
  });
});

// ─── Logger factory functions ─────────────────────────────────────────────────

describe('initializeLogger', () => {
  it('creates and stores a logger on state', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = initializeLogger('pull');
    expect(logger).toBeDefined();
    expect(getState().logger).toBe(logger);
    (console.log as jest.Mock).mockRestore();
  });
});

describe('initializeGuidLogger / getLoggerForGuid', () => {
  it('creates a logger for a specific GUID and retrieves it', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const logger = initializeGuidLogger('test-guid', 'push', 'content');
    const retrieved = getLoggerForGuid('test-guid');
    expect(retrieved).toBe(logger);
    expect(retrieved?.getGuid()).toBe('test-guid');
    (console.log as jest.Mock).mockRestore();
  });

  it('returns null for unknown GUID', () => {
    expect(getLoggerForGuid('does-not-exist')).toBeNull();
  });
});
