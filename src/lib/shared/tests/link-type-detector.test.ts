import { resetState } from 'core/state';
import { LinkTypeDetector } from '../link-type-detector';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── detectLinkType ────────────────────────────────────────────────────────────

describe('LinkTypeDetector.detectLinkType', () => {
  const detector = new LinkTypeDetector();

  it('returns unknown when field type is not Content', () => {
    const result = detector.detectLinkType({ type: 'Text', settings: {} });
    expect(result.type).toBe('unknown');
    expect(result.strategy).toBe('not-content-field');
    expect(result.requiresMapping).toBe(false);
    expect(result.followDependencies).toBe(false);
  });

  it('detects dropdown type when renderAs is dropdown and SharedContent is not _newcontent_agility_', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: 'dropdown', SharedContent: 'some-list', LinkedContentNestedTypeID: '', ContentView: '' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).toBe('dropdown');
    expect(result.requiresMapping).toBe(true);
    expect(result.followDependencies).toBe(false);
  });

  it('does NOT detect dropdown when SharedContent is _newcontent_agility_', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: 'dropdown', SharedContent: '_newcontent_agility_', LinkedContentNestedTypeID: '', ContentView: '' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).not.toBe('dropdown');
  });

  it('detects searchlistbox type when renderAs is searchlistbox', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: 'searchlistbox', SharedContent: '', LinkedContentNestedTypeID: '', ContentView: '' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).toBe('searchlistbox');
    expect(result.requiresMapping).toBe(true);
    expect(result.followDependencies).toBe(true);
  });

  it('detects grid type when renderAs is grid and nestedTypeID is 1', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: 'grid', LinkedContentNestedTypeID: '1', SharedContent: '', ContentView: '' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).toBe('grid');
    expect(result.requiresMapping).toBe(true);
    expect(result.followDependencies).toBe(true);
  });

  it('does NOT detect grid when nestedTypeID is not 1', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: 'grid', LinkedContentNestedTypeID: '0', SharedContent: '', ContentView: '' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).not.toBe('grid');
  });

  it('detects nested type when renderAs is empty and nestedTypeID is 0', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: '', LinkedContentNestedTypeID: '0', SharedContent: '', ContentView: '' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).toBe('nested');
    expect(result.requiresMapping).toBe(true);
    expect(result.followDependencies).toBe(true);
  });

  it('detects shared type when contentView and sharedContent are not _newcontent_agility_', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: 'some-other', LinkedContentNestedTypeID: '', SharedContent: 'some-content', ContentView: 'some-view' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).toBe('shared');
    expect(result.requiresMapping).toBe(true);
    expect(result.followDependencies).toBe(false);
  });

  it('returns unknown for unhandled pattern', () => {
    const field = {
      type: 'Content',
      settings: { RenderAs: 'other', LinkedContentNestedTypeID: '5', SharedContent: '_newcontent_agility_', ContentView: '_newcontent_agility_' }
    };
    const result = detector.detectLinkType(field);
    expect(result.type).toBe('unknown');
    expect(result.strategy).toBe('unhandled-pattern');
  });
});

// ─── analyzeModelContentFields ─────────────────────────────────────────────────

describe('LinkTypeDetector.analyzeModelContentFields', () => {
  const detector = new LinkTypeDetector();

  it('returns empty array when model has no fields', () => {
    expect(detector.analyzeModelContentFields({})).toEqual([]);
    expect(detector.analyzeModelContentFields({ fields: [] })).toEqual([]);
  });

  it('filters out non-Content fields', () => {
    const model = {
      fields: [
        { type: 'Text', name: 'title', settings: {} },
        { type: 'Number', name: 'count', settings: {} },
      ]
    };
    expect(detector.analyzeModelContentFields(model)).toHaveLength(0);
  });

  it('includes Content fields with correct fieldName and contentDefinition', () => {
    const model = {
      fields: [
        {
          type: 'Content',
          name: 'relatedArticles',
          settings: {
            RenderAs: 'dropdown',
            SharedContent: 'articles',
            ContentDefinition: 'article',
            LinkedContentNestedTypeID: '',
            ContentView: ''
          }
        }
      ]
    };
    const result = detector.analyzeModelContentFields(model);
    expect(result).toHaveLength(1);
    expect(result[0].fieldName).toBe('relatedArticles');
    expect(result[0].contentDefinition).toBe('article');
    expect(result[0].actualContentReferences).toContain('article');
  });

  it('captures LinkeContentDropdownValueField as fieldConfigurationString', () => {
    const model = {
      fields: [
        {
          type: 'Content',
          name: 'myField',
          settings: {
            RenderAs: 'dropdown',
            SharedContent: 'some-list',
            LinkeContentDropdownValueField: 'id',
            LinkeContentDropdownTextField: 'label',
            LinkedContentNestedTypeID: '',
            ContentView: '',
            ContentDefinition: 'myDef'
          }
        }
      ]
    };
    const result = detector.analyzeModelContentFields(model);
    expect(result[0].fieldConfigurationStrings).toContain('id');
    expect(result[0].fieldConfigurationStrings).toContain('label');
  });

  it('returns empty actualContentReferences when ContentDefinition is missing', () => {
    const model = {
      fields: [
        {
          type: 'Content',
          name: 'myField',
          settings: { RenderAs: '', LinkedContentNestedTypeID: '0', SharedContent: '', ContentView: '' }
        }
      ]
    };
    const result = detector.analyzeModelContentFields(model);
    expect(result[0].actualContentReferences).toHaveLength(0);
    expect(result[0].contentDefinition).toBe('');
  });
});

// ─── isFieldConfigurationString ────────────────────────────────────────────────

describe('LinkTypeDetector.isFieldConfigurationString', () => {
  const detector = new LinkTypeDetector();

  it('returns true when referenceString is a field configuration string', () => {
    const model = {
      fields: [
        {
          type: 'Content',
          name: 'myField',
          settings: {
            RenderAs: 'dropdown',
            SharedContent: 'some-list',
            LinkeContentDropdownValueField: 'itemID',
            LinkedContentNestedTypeID: '',
            ContentView: '',
            ContentDefinition: 'def'
          }
        }
      ]
    };
    expect(detector.isFieldConfigurationString('itemID', model)).toBe(true);
  });

  it('returns false when referenceString is NOT a field configuration string', () => {
    const model = {
      fields: [
        {
          type: 'Content',
          name: 'myField',
          settings: {
            RenderAs: 'dropdown',
            SharedContent: 'some-list',
            LinkeContentDropdownValueField: 'itemID',
            LinkedContentNestedTypeID: '',
            ContentView: '',
            ContentDefinition: 'myDef'
          }
        }
      ]
    };
    expect(detector.isFieldConfigurationString('myDef', model)).toBe(false);
  });

  it('returns false for model with no Content fields', () => {
    const model = { fields: [{ type: 'Text', name: 'title', settings: {} }] };
    expect(detector.isFieldConfigurationString('anything', model)).toBe(false);
  });
});

// ─── extractRealContentReferences ─────────────────────────────────────────────

describe('LinkTypeDetector.extractRealContentReferences', () => {
  const detector = new LinkTypeDetector();

  it('returns empty array when no Content fields have ContentDefinition', () => {
    const model = {
      fields: [
        {
          type: 'Content',
          name: 'myField',
          settings: { RenderAs: '', LinkedContentNestedTypeID: '0', SharedContent: '', ContentView: '' }
        }
      ]
    };
    expect(detector.extractRealContentReferences(model)).toHaveLength(0);
  });

  it('returns references for Content fields with ContentDefinition', () => {
    const model = {
      fields: [
        {
          type: 'Content',
          name: 'hero',
          settings: {
            RenderAs: 'dropdown',
            SharedContent: 'heroItems',
            ContentDefinition: 'hero-module',
            LinkedContentNestedTypeID: '',
            ContentView: ''
          }
        }
      ]
    };
    const result = detector.extractRealContentReferences(model);
    expect(result).toHaveLength(1);
    expect(result[0].fieldName).toBe('hero');
    expect(result[0].contentDefinition).toBe('hero-module');
    expect(result[0].linkType).toBeDefined();
  });
});

// ─── getLinkTypeDescription ────────────────────────────────────────────────────

describe('LinkTypeDetector.getLinkTypeDescription', () => {
  const detector = new LinkTypeDetector();

  it.each([
    ['dropdown', 'Dropdown'],
    ['searchlistbox', 'SearchListBox'],
    ['grid', 'Grid'],
    ['nested', 'Nested'],
    ['shared', 'Shared'],
    ['unknown', 'Unknown'],
  ] as const)('returns description containing "%s" keyword for type %s', (type, keyword) => {
    const result = detector.getLinkTypeDescription({ type, strategy: '', requiresMapping: false, followDependencies: false });
    expect(result).toContain(keyword);
  });
});
