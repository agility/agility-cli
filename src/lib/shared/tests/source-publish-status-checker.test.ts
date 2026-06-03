import { resetState } from 'core/state';
import {
  isPublished,
  filterPublishedContent,
  filterPublishedPages,
  checkSourcePublishStatus,
  ItemState
} from '../source-publish-status-checker';
import { fileOperations } from 'core/fileOperations';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── isPublished ──────────────────────────────────────────────────────────────

describe('isPublished', () => {
  it('returns true for ItemState.Published (2)', () => {
    expect(isPublished(ItemState.Published)).toBe(true);
  });

  it.each([
    ItemState.New,
    ItemState.None,
    ItemState.Staging,
    ItemState.Deleted,
    ItemState.Approved,
    ItemState.AwaitingApproval,
    ItemState.Declined,
    ItemState.Unpublished,
  ])('returns false for state %i', (state) => {
    expect(isPublished(state)).toBe(false);
  });
});

// ─── filterPublishedContent ────────────────────────────────────────────────────

describe('filterPublishedContent', () => {
  const makeMapping = (sourceContentID: number, targetContentID: number) => ({
    sourceGuid: 'src-guid',
    targetGuid: 'tgt-guid',
    sourceContentID,
    targetContentID,
    sourceVersionID: 1,
    targetVersionID: 1,
  });

  it('places targetContentID in publishedContentIds when source item is Published', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Published, modified: '', versionID: 1 }
    });

    const result = filterPublishedContent([makeMapping(10, 20)], 'src', ['en-us']);

    expect(result.publishedContentIds).toContain(20);
    expect(result.unpublishedContentIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('places targetContentID in unpublishedContentIds when source item is not Published', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Staging, modified: '', versionID: 1 }
    });

    const result = filterPublishedContent([makeMapping(10, 20)], 'src', ['en-us']);

    expect(result.unpublishedContentIds).toContain(20);
    expect(result.publishedContentIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('adds error and defaults to published when source item not found', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue(null);

    const result = filterPublishedContent([makeMapping(99, 200)], 'src', ['en-us']);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('99');
    expect(result.publishedContentIds).toContain(200);
  });

  it('stops checking locales after the first one that has the item', () => {
    const readJsonFileMock = jest.spyOn(fileOperations.prototype, 'readJsonFile')
      .mockReturnValueOnce({ properties: { state: ItemState.Published, modified: '', versionID: 1 } })
      .mockReturnValue(null);

    filterPublishedContent([makeMapping(10, 20)], 'src', ['en-us', 'fr-fr']);

    // Only the first locale should have been checked (readJsonFile called once)
    expect(readJsonFileMock).toHaveBeenCalledTimes(1);
  });

  it('tries subsequent locales when first locale returns null', () => {
    const readJsonFileMock = jest.spyOn(fileOperations.prototype, 'readJsonFile')
      .mockReturnValueOnce(null) // en-us — not found
      .mockReturnValueOnce({ properties: { state: ItemState.Published, modified: '', versionID: 1 } }); // fr-fr — found

    const result = filterPublishedContent([makeMapping(10, 20)], 'src', ['en-us', 'fr-fr']);

    expect(readJsonFileMock).toHaveBeenCalledTimes(2);
    expect(result.publishedContentIds).toContain(20);
    expect(result.errors).toHaveLength(0);
  });

  it('handles empty mappings array', () => {
    const result = filterPublishedContent([], 'src', ['en-us']);
    expect(result.publishedContentIds).toHaveLength(0);
    expect(result.unpublishedContentIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles item with properties missing (returns null data gracefully)', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({ /* no properties */ });

    const result = filterPublishedContent([makeMapping(10, 20)], 'src', ['en-us']);

    // No properties means item not found in this locale — error added, defaults to published
    expect(result.errors).toHaveLength(1);
    expect(result.publishedContentIds).toContain(20);
  });
});

// ─── filterPublishedPages ──────────────────────────────────────────────────────

describe('filterPublishedPages', () => {
  const makePageMapping = (sourcePageID: number, targetPageID: number) => ({
    sourceGuid: 'src-guid',
    targetGuid: 'tgt-guid',
    sourcePageID,
    targetPageID,
    sourceVersionID: 1,
    targetVersionID: 1,
    sourcePageTemplateName: null,
    targetPageTemplateName: null,
  });

  it('places targetPageID in publishedPageIds when source page is Published', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Published, modified: '', versionID: 1 }
    });

    const result = filterPublishedPages([makePageMapping(1, 10)], 'src', ['en-us']);

    expect(result.publishedPageIds).toContain(10);
    expect(result.unpublishedPageIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('places targetPageID in unpublishedPageIds when source page is not Published', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Unpublished, modified: '', versionID: 1 }
    });

    const result = filterPublishedPages([makePageMapping(1, 10)], 'src', ['en-us']);

    expect(result.unpublishedPageIds).toContain(10);
    expect(result.publishedPageIds).toHaveLength(0);
  });

  it('adds error and defaults to published when page not found', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue(null);

    const result = filterPublishedPages([makePageMapping(55, 100)], 'src', ['en-us']);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('55');
    expect(result.publishedPageIds).toContain(100);
  });

  it('handles empty page mappings array', () => {
    const result = filterPublishedPages([], 'src', ['en-us']);
    expect(result.publishedPageIds).toHaveLength(0);
    expect(result.unpublishedPageIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── checkSourcePublishStatus ──────────────────────────────────────────────────

describe('checkSourcePublishStatus', () => {
  const makeContentMapping = (sourceContentID: number, targetContentID: number) => ({
    sourceGuid: 'src',
    targetGuid: 'tgt',
    sourceContentID,
    targetContentID,
    sourceVersionID: 1,
    targetVersionID: 1,
  });

  const makePageMapping = (sourcePageID: number, targetPageID: number) => ({
    sourceGuid: 'src',
    targetGuid: 'tgt',
    sourcePageID,
    targetPageID,
    sourceVersionID: 1,
    targetVersionID: 1,
    sourcePageTemplateName: null,
    targetPageTemplateName: null,
  });

  it('combines content and page results into a single PublishStatusResult', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Published, modified: '', versionID: 1 }
    });

    const result = checkSourcePublishStatus(
      [makeContentMapping(1, 10)],
      [makePageMapping(2, 20)],
      'src',
      ['en-us']
    );

    expect(result.publishedContentIds).toContain(10);
    expect(result.publishedPageIds).toContain(20);
  });

  it('deduplicates publishedContentIds', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Published, modified: '', versionID: 1 }
    });

    // Same targetContentID from two locales (simulating duplicate mappings)
    const result = checkSourcePublishStatus(
      [makeContentMapping(1, 10), makeContentMapping(1, 10)],
      [],
      'src',
      ['en-us']
    );

    const occurrences = result.publishedContentIds.filter(id => id === 10);
    expect(occurrences).toHaveLength(1);
  });

  it('deduplicates unpublishedContentIds', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Staging, modified: '', versionID: 1 }
    });

    const result = checkSourcePublishStatus(
      [makeContentMapping(1, 10), makeContentMapping(1, 10)],
      [],
      'src',
      ['en-us']
    );

    const occurrences = result.unpublishedContentIds.filter(id => id === 10);
    expect(occurrences).toHaveLength(1);
  });

  it('deduplicates publishedPageIds', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue({
      properties: { state: ItemState.Published, modified: '', versionID: 1 }
    });

    const result = checkSourcePublishStatus(
      [],
      [makePageMapping(2, 20), makePageMapping(2, 20)],
      'src',
      ['en-us']
    );

    const occurrences = result.publishedPageIds.filter(id => id === 20);
    expect(occurrences).toHaveLength(1);
  });

  it('merges errors from both content and page checks', () => {
    jest.spyOn(fileOperations.prototype, 'readJsonFile').mockReturnValue(null);

    const result = checkSourcePublishStatus(
      [makeContentMapping(1, 10)],
      [makePageMapping(2, 20)],
      'src',
      ['en-us']
    );

    expect(result.errors).toHaveLength(2);
  });

  it('handles empty mappings for both content and pages', () => {
    const result = checkSourcePublishStatus([], [], 'src', ['en-us']);
    expect(result.publishedContentIds).toHaveLength(0);
    expect(result.unpublishedContentIds).toHaveLength(0);
    expect(result.publishedPageIds).toHaveLength(0);
    expect(result.unpublishedPageIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
