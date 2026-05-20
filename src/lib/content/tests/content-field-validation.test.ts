import { resetState } from 'core/state';
import {
  ContentFieldValidator,
  createContentFieldValidator,
  validateField,
  FieldValidationResult,
} from 'lib/content/content-field-validation';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── createContentFieldValidator / validateField factories ────────────────────

describe('createContentFieldValidator', () => {
  it('returns a ContentFieldValidator instance', () => {
    expect(createContentFieldValidator()).toBeInstanceOf(ContentFieldValidator);
  });
});

describe('validateField (standalone helper)', () => {
  it('returns isValid:true for a plain string', () => {
    const result = validateField('title', 'Hello');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns isValid:false for a non-positive contentid', () => {
    const result = validateField('ref', { contentid: -1 });
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ─── validateContentFields ────────────────────────────────────────────────────

describe('ContentFieldValidator.validateContentFields', () => {
  let validator: ContentFieldValidator;

  beforeEach(() => {
    validator = new ContentFieldValidator();
  });

  describe('null / non-object inputs', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['a string', 'text'],
    ])('returns isValid:true with zero counts for %s', (_label, input) => {
      const result = validator.validateContentFields(input as any);
      expect(result.isValid).toBe(true);
      expect(result.totalWarnings).toBe(0);
      expect(result.totalErrors).toBe(0);
      expect(result.fieldResults.size).toBe(0);
    });
  });

  describe('primitive fields', () => {
    it('validates a plain string field as valid', () => {
      const result = validator.validateContentFields({ title: 'My Title' });
      expect(result.isValid).toBe(true);
      expect(result.totalErrors).toBe(0);
      expect(result.validatedFields.title).toBe('My Title');
    });

    it('validates a number field without an id-like name as valid', () => {
      const result = validator.validateContentFields({ count: 5 });
      expect(result.isValid).toBe(true);
    });

    it('validates a boolean field as valid', () => {
      const result = validator.validateContentFields({ active: true });
      expect(result.isValid).toBe(true);
      expect(result.totalErrors).toBe(0);
    });

    it('validates null and undefined field values as valid', () => {
      const result = validator.validateContentFields({ a: null, b: undefined });
      expect(result.isValid).toBe(true);
    });
  });

  describe('numeric id fields', () => {
    it('returns an error for a non-positive ID field', () => {
      const result = validator.validateContentFields({ categoryId: -1 });
      expect(result.isValid).toBe(false);
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('returns an error for a zero ID field', () => {
      const result = validator.validateContentFields({ contentid: 0 });
      expect(result.isValid).toBe(false);
    });

    it('passes a positive numeric id field', () => {
      const result = validator.validateContentFields({ categoryId: 10 });
      expect(result.isValid).toBe(true);
      expect(result.totalErrors).toBe(0);
    });
  });

  describe('asset URL string fields', () => {
    it('validates a well-formed cdn.aglty.io URL', () => {
      const result = validator.validateContentFields({
        image: 'https://cdn.aglty.io/guid/assets/photo.jpg',
      });
      expect(result.totalErrors).toBe(0);
    });

    it('returns an error for a malformed cdn.aglty.io "URL"', () => {
      const result = validator.validateContentFields({
        image: 'not-a-url-cdn.aglty.io',
      });
      expect(result.isValid).toBe(false);
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('returns a warning when sourceAssets is provided but the URL is not found', () => {
      const result = validator.validateContentFields(
        { image: 'https://cdn.aglty.io/guid/assets/missing.jpg' },
        { sourceAssets: [] }
      );
      expect(result.totalWarnings).toBeGreaterThan(0);
    });

    it('does not warn when the URL is present in sourceAssets via url property', () => {
      const url = 'https://cdn.aglty.io/guid/assets/photo.jpg';
      const result = validator.validateContentFields(
        { image: url },
        { sourceAssets: [{ url }] }
      );
      expect(result.totalWarnings).toBe(0);
    });

    it('does not warn when the URL is present in sourceAssets via originUrl', () => {
      const url = 'https://cdn.aglty.io/guid/assets/photo.jpg';
      const result = validator.validateContentFields(
        { image: url },
        { sourceAssets: [{ originUrl: url }] }
      );
      expect(result.totalWarnings).toBe(0);
    });

    it('warns for a field that exceeds the recommended length', () => {
      const longString = 'a'.repeat(10001);
      const result = validator.validateContentFields({ body: longString });
      expect(result.totalWarnings).toBeGreaterThan(0);
    });
  });

  describe('content ID string fields', () => {
    it('validates a valid comma-separated categoryid string', () => {
      const result = validator.validateContentFields({ categoryid: '1,2,3' });
      expect(result.isValid).toBe(true);
      expect(result.totalErrors).toBe(0);
    });

    it('does not error for a categoryid string containing non-numeric parts because isContentIdField guards on the pattern', () => {
      // isContentIdField only triggers when the value already matches /^\d+(,\d+)*$/
      // so '1,abc,3' is treated as a plain string and passes through without error
      const result = validator.validateContentFields({ categoryid: '1,abc,3' });
      expect(result.isValid).toBe(true);
      expect(result.totalErrors).toBe(0);
    });

    it('returns an error for a zero ID in a categoryid string (zero fails parseInt(id) > 0 check)', () => {
      const result = validator.validateContentFields({ categoryid: '0,2' });
      expect(result.isValid).toBe(false);
      expect(result.totalErrors).toBeGreaterThan(0);
    });
  });

  describe('content reference object fields (contentid / contentID)', () => {
    it('returns an error for a non-positive contentid in an object field', () => {
      const result = validator.validateContentFields({ ref: { contentid: -5 } });
      expect(result.isValid).toBe(false);
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('returns an error for a non-positive contentID in an object field', () => {
      const result = validator.validateContentFields({ ref: { contentID: 0 } });
      expect(result.isValid).toBe(false);
    });

    it('passes a positive contentid in an object field', () => {
      const result = validator.validateContentFields({ ref: { contentid: 42 } });
      expect(result.totalErrors).toBe(0);
    });

    it('passes a positive contentID in an object field', () => {
      const result = validator.validateContentFields({ ref: { contentID: 42 } });
      expect(result.totalErrors).toBe(0);
    });

    it('returns an error for a string contentid in an object field', () => {
      const result = validator.validateContentFields({ ref: { contentid: 'bad' } });
      expect(result.isValid).toBe(false);
    });
  });

  describe('referencename + sortids pattern', () => {
    it('passes valid sortids with a referencename', () => {
      const result = validator.validateContentFields({
        items: { referencename: 'my-list', sortids: '1,2,3' },
      });
      expect(result.totalErrors).toBe(0);
    });

    it('returns an error for invalid sortids', () => {
      const result = validator.validateContentFields({
        items: { referencename: 'my-list', sortids: '1,abc' },
      });
      expect(result.isValid).toBe(false);
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('returns an error for zero sortids', () => {
      const result = validator.validateContentFields({
        items: { referencename: 'my-list', sortids: '0,2' },
      });
      expect(result.isValid).toBe(false);
    });

    it('warns when the container reference is not found in sourceContainers', () => {
      const result = validator.validateContentFields(
        { items: { referencename: 'ghost-list', sortids: '1' } },
        { sourceContainers: [{ referenceName: 'other-list' }] }
      );
      expect(result.totalWarnings).toBeGreaterThan(0);
    });

    it('does not warn when the container reference IS found in sourceContainers', () => {
      const result = validator.validateContentFields(
        { items: { referencename: 'known-list', sortids: '1' } },
        { sourceContainers: [{ referenceName: 'known-list' }] }
      );
      expect(result.totalWarnings).toBe(0);
    });
  });

  describe('gallery reference fields', () => {
    it('returns an error for a non-positive mediaGroupingID', () => {
      const result = validator.validateContentFields({ gallery: { mediaGroupingID: -1 } });
      expect(result.isValid).toBe(false);
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('passes a positive mediaGroupingID', () => {
      const result = validator.validateContentFields({ gallery: { mediaGroupingID: 10 } });
      expect(result.totalErrors).toBe(0);
    });
  });

  describe('array field validation', () => {
    it('validates each item in an array field recursively', () => {
      const result = validator.validateContentFields({
        items: [
          { contentid: 1 },
          { contentid: -5 },
        ],
      });
      expect(result.isValid).toBe(false);
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('passes when all array items are valid', () => {
      const result = validator.validateContentFields({
        items: [{ contentid: 1 }, { contentid: 2 }],
      });
      expect(result.totalErrors).toBe(0);
    });
  });

  describe('fieldResults map', () => {
    it('contains an entry per validated field', () => {
      const result = validator.validateContentFields({ a: 'x', b: 'y' });
      expect(result.fieldResults.size).toBe(2);
      expect(result.fieldResults.has('a')).toBe(true);
      expect(result.fieldResults.has('b')).toBe(true);
    });
  });
});

// ─── sanitizeField ────────────────────────────────────────────────────────────

describe('ContentFieldValidator.sanitizeField', () => {
  let validator: ContentFieldValidator;

  beforeEach(() => {
    validator = new ContentFieldValidator();
  });

  it('returns null unchanged', () => {
    expect(validator.sanitizeField('f', null)).toBeNull();
  });

  it('returns undefined unchanged', () => {
    expect(validator.sanitizeField('f', undefined)).toBeUndefined();
  });

  it('trims whitespace from string fields', () => {
    expect(validator.sanitizeField('title', '  hello  ')).toBe('hello');
  });

  it('removes null characters from string fields', () => {
    expect(validator.sanitizeField('body', 'hello\0world')).toBe('helloworld');
  });

  it('returns 0 for non-finite numbers', () => {
    expect(validator.sanitizeField('val', Infinity)).toBe(0);
    expect(validator.sanitizeField('val', NaN)).toBe(0);
  });

  it('preserves finite numbers unchanged', () => {
    expect(validator.sanitizeField('count', 42)).toBe(42);
    expect(validator.sanitizeField('price', -3.14)).toBe(-3.14);
  });

  it('sanitizes string values inside nested objects recursively', () => {
    const result = validator.sanitizeField('obj', { text: '  padded  ' });
    expect(result.text).toBe('padded');
  });

  it('sanitizes string values inside arrays recursively', () => {
    const result = validator.sanitizeField('arr', ['  a  ', '  b  ']);
    expect(result).toEqual(['a', 'b']);
  });

  it('passes through boolean values unchanged', () => {
    expect(validator.sanitizeField('flag', true)).toBe(true);
    expect(validator.sanitizeField('flag', false)).toBe(false);
  });
});

// ─── getValidationSummary ─────────────────────────────────────────────────────

describe('ContentFieldValidator.getValidationSummary', () => {
  let validator: ContentFieldValidator;

  beforeEach(() => {
    validator = new ContentFieldValidator();
  });

  it('returns zero counts for an empty map', () => {
    const summary = validator.getValidationSummary(new Map());
    expect(summary.totalFields).toBe(0);
    expect(summary.validFields).toBe(0);
    expect(summary.fieldsWithWarnings).toBe(0);
    expect(summary.fieldsWithErrors).toBe(0);
    expect(summary.criticalFields).toHaveLength(0);
  });

  it('counts valid, warned, and errored fields correctly', () => {
    const fieldResults = new Map<string, FieldValidationResult>([
      ['ok', { isValid: true, field: 'x', warnings: [], errors: [] }],
      ['warned', { isValid: true, field: 'y', warnings: ['w1'], errors: [] }],
      ['errored', { isValid: false, field: 'z', warnings: [], errors: ['e1'] }],
    ]);
    const summary = validator.getValidationSummary(fieldResults);
    expect(summary.totalFields).toBe(3);
    expect(summary.validFields).toBe(2);
    expect(summary.fieldsWithWarnings).toBe(1);
    expect(summary.fieldsWithErrors).toBe(1);
    expect(summary.criticalFields).toContain('errored');
    expect(summary.criticalFields).not.toContain('ok');
  });

  it('includes a field in criticalFields when it has errors', () => {
    const fieldResults = new Map<string, FieldValidationResult>([
      ['badField', { isValid: false, field: null, warnings: [], errors: ['bad content ID'] }],
    ]);
    const { criticalFields } = validator.getValidationSummary(fieldResults);
    expect(criticalFields).toContain('badField');
  });

  it('derives summary from validateContentFields output', () => {
    const { fieldResults } = validator.validateContentFields({
      title: 'Good',
      ref: { contentid: -1 },
    });
    const summary = validator.getValidationSummary(fieldResults);
    expect(summary.totalFields).toBe(2);
    expect(summary.fieldsWithErrors).toBe(1);
    expect(summary.criticalFields).toContain('ref');
  });
});
