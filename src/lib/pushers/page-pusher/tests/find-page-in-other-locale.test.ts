import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState, state } from 'core/state';
import { findPageInOtherLocale } from '../find-page-in-other-locale';

// PageMapper reads mapping files from disk — redirect file I/O to tmpDir
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-fpiol-'));
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

// ─── helpers ──────────────────────────────────────────────────────────────────

const SOURCE_GUID = 'src-guid';
const TARGET_GUID = 'tgt-guid';

// Mapping files are stored at: {rootPath}/mappings/{sourceGuid}-{targetGuid}/{locale}/page/mappings.json
function writeMappingFile(sourceGuid: string, targetGuid: string, locale: string, mappings: any[]): void {
  const dir = path.join(tmpDir, 'mappings', `${sourceGuid}-${targetGuid}`, locale, 'page');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mappings.json'), JSON.stringify(mappings));
}

function makeMapping(sourcePageID: number, targetPageID: number): any {
  return {
    sourceGuid: SOURCE_GUID,
    targetGuid: TARGET_GUID,
    sourcePageID,
    targetPageID,
    sourceVersionID: 1,
    targetVersionID: 1,
    sourcePageTemplateName: 'Template',
    targetPageTemplateName: 'Template',
  };
}

// ─── no other locales ────────────────────────────────────────────────────────

describe('findPageInOtherLocale — no other locales', () => {
  it('returns null when availableLocales is empty', async () => {
    state.availableLocales = [];
    const result = await findPageInOtherLocale({
      sourcePageID: 1,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });
    expect(result).toBeNull();
  });

  it('returns null when the only available locale is the current locale (skips self)', async () => {
    state.availableLocales = ['en-us'];
    const result = await findPageInOtherLocale({
      sourcePageID: 1,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });
    expect(result).toBeNull();
  });
});

// ─── mapping not found in other locales ───────────────────────────────────────

describe('findPageInOtherLocale — no mapping in other locales', () => {
  it('returns null when other locale has no mapping for the given pageID', async () => {
    state.availableLocales = ['en-us', 'fr-fr'];
    // Write fr-fr mapping for a DIFFERENT page
    writeMappingFile(SOURCE_GUID, TARGET_GUID, 'fr-fr', [makeMapping(999, 888)]);

    const result = await findPageInOtherLocale({
      sourcePageID: 1,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });
    expect(result).toBeNull();
  });

  it('returns null when other locale mapping file is missing', async () => {
    state.availableLocales = ['en-us', 'de-de'];
    // No mapping file written for de-de

    const result = await findPageInOtherLocale({
      sourcePageID: 42,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });
    expect(result).toBeNull();
  });
});

// ─── mapping found in other locale ───────────────────────────────────────────

describe('findPageInOtherLocale — mapping found in other locale', () => {
  it('returns the target page ID and locale when mapping exists in another locale', async () => {
    state.availableLocales = ['en-us', 'fr-fr'];
    writeMappingFile(SOURCE_GUID, TARGET_GUID, 'fr-fr', [makeMapping(10, 20)]);

    const result = await findPageInOtherLocale({
      sourcePageID: 10,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });

    expect(result).not.toBeNull();
    expect(result!.PageIDOtherLanguage).toBe(20);
    expect(result!.OtherLanguageCode).toBe('fr-fr');
  });

  it('stops searching after the first successful match', async () => {
    state.availableLocales = ['en-us', 'fr-fr', 'de-de'];
    writeMappingFile(SOURCE_GUID, TARGET_GUID, 'fr-fr', [makeMapping(5, 50)]);
    writeMappingFile(SOURCE_GUID, TARGET_GUID, 'de-de', [makeMapping(5, 55)]);

    const result = await findPageInOtherLocale({
      sourcePageID: 5,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });

    // Should return the first match (fr-fr), not de-de
    expect(result).not.toBeNull();
    expect(result!.OtherLanguageCode).toBe('fr-fr');
    expect(result!.PageIDOtherLanguage).toBe(50);
  });

  it('skips the current locale and finds mapping in later locale', async () => {
    state.availableLocales = ['en-us', 'fr-fr'];
    // en-us is the current locale — should be skipped; fr-fr should be found
    writeMappingFile(SOURCE_GUID, TARGET_GUID, 'fr-fr', [makeMapping(7, 77)]);

    const result = await findPageInOtherLocale({
      sourcePageID: 7,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });

    expect(result).not.toBeNull();
    expect(result!.OtherLanguageCode).toBe('fr-fr');
  });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe('findPageInOtherLocale — error handling', () => {
  it('logs an error and returns null when getPageMappingByPageID throws inside the try block', async () => {
    state.availableLocales = ['en-us', 'fr-fr'];

    // Corrupt the already-loaded PageMapper so getPageMappingByPageID throws.
    // We do this by mocking PageMapper entirely for this test.
    const { PageMapper } = require('lib/mappers/page-mapper');
    const originalImplementation = PageMapper;

    jest.doMock('lib/mappers/page-mapper', () => ({
      PageMapper: jest.fn().mockImplementation(() => ({
        getPageMappingByPageID: jest.fn().mockImplementation(() => {
          throw new Error('lookup error');
        }),
      })),
    }));

    // Re-import with the mock active — note: jest.doMock doesn't auto-reset module registry,
    // so we test the console.error path directly via a spy approach instead.
    // The real source code catches errors thrown by getPageMappingByPageID (inside the try block).
    // We'll trigger this by spying on console.error instead.

    // Restore original implementation
    jest.dontMock('lib/mappers/page-mapper');

    // Simpler approach: test that when getPageMappingByPageID throws, console.error is called.
    // Since PageMapper constructor is outside the try block, errors there propagate up.
    // Errors inside the try block (from getPageMappingByPageID) are caught and logged.
    // We validate the catch path via a spy on the real PageMapper prototype.
    const { PageMapper: RealPageMapper } = require('lib/mappers/page-mapper');
    const spy = jest.spyOn(RealPageMapper.prototype, 'getPageMappingByPageID')
      .mockImplementation(() => { throw new Error('lookup error'); });
    const consoleSpy = jest.spyOn(console, 'error');

    const result = await findPageInOtherLocale({
      sourcePageID: 99,
      locale: 'en-us',
      sourceGuid: SOURCE_GUID,
      targetGuid: TARGET_GUID,
    });

    spy.mockRestore();
    expect(consoleSpy).toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
