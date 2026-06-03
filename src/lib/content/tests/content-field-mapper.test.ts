import { resetState } from 'core/state';
import { ContentFieldMapper, createContentFieldMapper } from 'lib/content/content-field-mapper';

// Prevent ContentItemMapper and AssetMapper constructors from touching the filesystem
jest.mock('lib/mappers/content-item-mapper', () => ({
  ContentItemMapper: jest.fn().mockImplementation(() => ({
    getContentItemMappingByContentID: jest.fn().mockReturnValue(null),
  })),
}));

jest.mock('lib/mappers/asset-mapper', () => ({
  AssetMapper: jest.fn().mockImplementation(() => ({
    getAssetMappingByMediaUrl: jest.fn().mockReturnValue(null),
    remapUrlByContainer: jest.fn().mockReturnValue(null),
  })),
}));

// Prevent AssetReferenceExtractor from causing side-effects
jest.mock('lib/assets/asset-reference-extractor', () => ({
  AssetReferenceExtractor: jest.fn().mockImplementation(() => ({})),
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

function makeMapper(): ContentFieldMapper {
  return new ContentFieldMapper();
}

function makeReferenceMapper(overrides: any = {}): any {
  return {
    getContentItemMappingByContentID: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

function makeAssetMapper(overrides: any = {}): any {
  return {
    getAssetMappingByMediaUrl: jest.fn().mockReturnValue(null),
    remapUrlByContainer: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

// ─── createContentFieldMapper ─────────────────────────────────────────────────

describe('createContentFieldMapper', () => {
  it('returns a ContentFieldMapper instance', () => {
    expect(createContentFieldMapper()).toBeInstanceOf(ContentFieldMapper);
  });
});

// ─── mapContentFields — null / non-object inputs ──────────────────────────────

describe('ContentFieldMapper.mapContentFields', () => {
  let mapper: ContentFieldMapper;

  beforeEach(() => {
    mapper = makeMapper();
  });

  describe('null / non-object inputs', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['a string', 'hello'],
    ])('returns the input unchanged for %s with zero warnings/errors', (_label, input) => {
      const result = mapper.mapContentFields(input as any);
      expect(result.mappedFields).toBe(input);
      expect(result.validationWarnings).toBe(0);
      expect(result.validationErrors).toBe(0);
    });
  });

  describe('primitive field pass-through', () => {
    it('passes through string, number and boolean fields unchanged when no context is given', () => {
      const fields = { title: 'Hello', count: 5, active: true };
      const result = mapper.mapContentFields(fields);
      expect(result.mappedFields).toEqual(fields);
      expect(result.validationErrors).toBe(0);
    });
  });

  describe('list reference fields', () => {
    it('passes through a referencename+fulllist field unchanged', () => {
      const fields = {
        items: { referencename: 'my-list', fulllist: true },
      };
      const result = mapper.mapContentFields(fields);
      expect(result.mappedFields.items).toEqual(fields.items);
      expect(result.validationErrors).toBe(0);
    });

    it('passes through a referenceName+fullList (camelCase) field unchanged', () => {
      const fields = {
        items: { referenceName: 'other-list', fullList: true },
      };
      const result = mapper.mapContentFields(fields);
      expect(result.mappedFields.items).toEqual(fields.items);
    });
  });

  describe('asset attachment fields — no context', () => {
    it('returns a warning when a single asset object has no referenceMapper context', () => {
      const fields = { image: { url: 'https://cdn.aglty.io/guid/assets/photo.jpg', label: 'Hero' } };
      const result = mapper.mapContentFields(fields);
      expect(result.validationWarnings).toBeGreaterThan(0);
    });

    it('returns a warning for an AttachmentList array when no referenceMapper context is provided', () => {
      const fields = {
        gallery: [
          { url: 'https://cdn.aglty.io/guid/assets/a.jpg' },
          { url: 'https://cdn.aglty.io/guid/assets/b.jpg' },
        ],
      };
      const result = mapper.mapContentFields(fields);
      expect(result.validationWarnings).toBeGreaterThan(0);
    });
  });

  describe('asset attachment fields — with context', () => {
    it('maps the URL using assetMapper when an exact URL match is found', () => {
      const assetMapper = makeAssetMapper({
        getAssetMappingByMediaUrl: jest.fn().mockReturnValue({
          sourceUrl: 'https://cdn.aglty.io/src/assets/photo.jpg',
          targetUrl: 'https://cdn.aglty.io/tgt/assets/photo.jpg',
        }),
      });
      const context = {
        referenceMapper: makeReferenceMapper(),
        assetMapper,
      };
      const fields = { image: { url: 'https://cdn.aglty.io/src/assets/photo.jpg', label: 'Hero' } };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.image.url).toBe('https://cdn.aglty.io/tgt/assets/photo.jpg');
      expect(result.validationErrors).toBe(0);
    });

    it('leaves the URL unchanged when assetMapper returns null', () => {
      const context = {
        referenceMapper: makeReferenceMapper(),
        assetMapper: makeAssetMapper(),
      };
      const fields = { image: { url: 'https://cdn.aglty.io/guid/assets/photo.jpg' } };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.image.url).toBe('https://cdn.aglty.io/guid/assets/photo.jpg');
    });

    it('maps URLs in an array of asset objects', () => {
      const assetMapper = makeAssetMapper({
        getAssetMappingByMediaUrl: jest.fn().mockImplementation((url: string) => {
          if (url === 'https://cdn.aglty.io/src/assets/a.jpg') {
            return { sourceUrl: url, targetUrl: 'https://cdn.aglty.io/tgt/assets/a.jpg' };
          }
          return null;
        }),
      });
      const context = { referenceMapper: makeReferenceMapper(), assetMapper };
      const fields = {
        gallery: [{ url: 'https://cdn.aglty.io/src/assets/a.jpg' }],
      };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.gallery[0].url).toBe('https://cdn.aglty.io/tgt/assets/a.jpg');
    });
  });

  describe('content reference fields', () => {
    it('adds a warning when a contentid field has no referenceMapper context', () => {
      const fields = { related: { contentid: 10 } };
      const result = mapper.mapContentFields(fields);
      expect(result.validationWarnings).toBeGreaterThan(0);
    });

    it('maps contentid when referenceMapper finds the source content', () => {
      const referenceMapper = makeReferenceMapper({
        getContentItemMappingByContentID: jest.fn().mockReturnValue({ contentID: 99 }),
      });
      const context = { referenceMapper, assetMapper: makeAssetMapper() };
      const fields = { related: { contentid: 10 } };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.related.contentid).toBe(99);
      expect(result.validationErrors).toBe(0);
    });

    it('maps contentID (capital D) when referenceMapper finds the source content', () => {
      const referenceMapper = makeReferenceMapper({
        getContentItemMappingByContentID: jest.fn().mockReturnValue({ contentID: 77 }),
      });
      const context = { referenceMapper, assetMapper: makeAssetMapper() };
      const fields = { link: { contentID: 10 } };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.link.contentID).toBe(77);
    });

    it('increments warnings when contentid mapping is not found', () => {
      const context = {
        referenceMapper: makeReferenceMapper(),
        assetMapper: makeAssetMapper(),
      };
      const fields = { related: { contentid: 10 } };
      const result = mapper.mapContentFields(fields, context);
      expect(result.validationWarnings).toBeGreaterThan(0);
    });

    it('maps sortids by replacing each source ID with its target ID', () => {
      const referenceMapper = makeReferenceMapper({
        getContentItemMappingByContentID: jest.fn().mockImplementation((id: number) => {
          const map: Record<number, number> = { 1: 101, 2: 102, 3: 103 };
          return map[id] ? { contentID: map[id] } : null;
        }),
      });
      const context = { referenceMapper, assetMapper: makeAssetMapper() };
      const fields = { list: { sortids: '1,2,3' } };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.list.sortids).toBe('101,102,103');
    });

    it('keeps original ID when sortid mapping is not found', () => {
      const context = {
        referenceMapper: makeReferenceMapper(),
        assetMapper: makeAssetMapper(),
      };
      const fields = { list: { sortids: '5,6' } };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.list.sortids).toBe('5,6');
    });
  });

  describe('cdn URL string fields', () => {
    it('increments validationErrors for a cdn.aglty.io string field when no context is given (mapAssetUrl throws)', () => {
      // mapAssetUrl unconditionally accesses context.assetMapper, so passing no context throws,
      // which the outer catch in mapContentFields turns into an error increment.
      const fields = { heroUrl: 'https://cdn.aglty.io/guid/assets/img.jpg' };
      const result = mapper.mapContentFields(fields);
      expect(result.validationErrors).toBeGreaterThan(0);
    });

    it('maps a top-level cdn.aglty.io string field using assetMapper container remapping', () => {
      const assetMapper = makeAssetMapper({
        getAssetMappingByMediaUrl: jest.fn().mockReturnValue({ sourceUrl: 'mismatch', targetUrl: 'x' }),
        remapUrlByContainer: jest.fn().mockReturnValue('https://cdn.aglty.io/tgt/assets/img.jpg'),
      });
      const context = { referenceMapper: makeReferenceMapper(), assetMapper };
      const fields = { heroUrl: 'https://cdn.aglty.io/src/assets/img.jpg' };
      const result = mapper.mapContentFields(fields, context);
      expect(result.mappedFields.heroUrl).toBe('https://cdn.aglty.io/tgt/assets/img.jpg');
    });
  });

  describe('nested object fields', () => {
    it('recursively processes nested plain objects', () => {
      const fields = {
        section: {
          title: 'Section Title',
          count: 3,
        },
      };
      const result = mapper.mapContentFields(fields);
      expect(result.mappedFields.section.title).toBe('Section Title');
      expect(result.mappedFields.section.count).toBe(3);
      expect(result.validationErrors).toBe(0);
    });

    it('recursively processes nested arrays of primitives', () => {
      const fields = { tags: ['a', 'b', 'c'] };
      const result = mapper.mapContentFields(fields);
      expect(result.mappedFields.tags).toEqual(['a', 'b', 'c']);
    });
  });

  describe('error handling', () => {
    it('increments validationErrors and keeps original value when a field mapping throws', () => {
      const badMapper = makeMapper();
      // Make the internal mapSingleField throw by feeding a context whose assetMapper throws
      const context = {
        referenceMapper: makeReferenceMapper(),
        assetMapper: {
          getAssetMappingByMediaUrl: jest.fn().mockImplementation(() => {
            throw new Error('boom');
          }),
          remapUrlByContainer: jest.fn(),
        } as any,
      };
      const fields = { heroUrl: 'https://cdn.aglty.io/guid/assets/img.jpg' };
      const result = badMapper.mapContentFields(fields, context);
      expect(result.validationErrors).toBeGreaterThan(0);
      expect(result.mappedFields.heroUrl).toBe(fields.heroUrl);
    });
  });
});
