import { resetState } from 'core/state';
import { ContentClassifier } from 'lib/content/content-classifier';

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

function makeModel(referenceName: string, fields: any[] = []): any {
  return { referenceName, fields };
}

function makeContentItem(definitionName: string, fields: any = {}): any {
  return {
    contentID: 1,
    properties: { definitionName },
    fields,
  };
}

// ─── classifyContent ──────────────────────────────────────────────────────────

describe('ContentClassifier.classifyContent', () => {
  let classifier: ContentClassifier;

  beforeEach(() => {
    classifier = new ContentClassifier();
  });

  describe('empty / edge-case inputs', () => {
    it('returns empty arrays when no content items are provided', async () => {
      const result = await classifier.classifyContent([], []);
      expect(result.normalContentItems).toHaveLength(0);
      expect(result.linkedContentItems).toHaveLength(0);
      expect(result.classificationDetails.totalItems).toBe(0);
    });

    it('treats an item with no definitionName as normal content', async () => {
      const item: any = { contentID: 1, properties: {}, fields: {} };
      const result = await classifier.classifyContent([item], []);
      expect(result.normalContentItems).toHaveLength(1);
      expect(result.linkedContentItems).toHaveLength(0);
    });

    it('treats an item whose model is not found in the models list as normal content', async () => {
      const item = makeContentItem('UnknownModel', {});
      const result = await classifier.classifyContent([item], []);
      expect(result.normalContentItems).toHaveLength(1);
      expect(result.linkedContentItems).toHaveLength(0);
    });
  });

  describe('normal content (no linked references)', () => {
    it('classifies an item with no Content-type fields as normal', async () => {
      const model = makeModel('BlogPost', [
        { name: 'Title', type: 'Text' },
        { name: 'Body', type: 'HTML' },
      ]);
      const item = makeContentItem('BlogPost', { title: 'Hello', body: '<p>World</p>' });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.normalContentItems).toHaveLength(1);
      expect(result.linkedContentItems).toHaveLength(0);
    });

    it('classifies an item with a Content field but no actual linked-content values as normal', async () => {
      const model = makeModel('Article', [
        { name: 'Author', type: 'Content' },
        { name: 'Title', type: 'Text' },
      ]);
      const item = makeContentItem('Article', { author: null, title: 'My Article' });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.normalContentItems).toHaveLength(1);
      expect(result.linkedContentItems).toHaveLength(0);
    });

    it('classifies an item whose fields object is absent as normal', async () => {
      const model = makeModel('Simple', [{ name: 'Name', type: 'Content' }]);
      const item: any = { contentID: 5, properties: { definitionName: 'Simple' } };
      const result = await classifier.classifyContent([item], [model]);
      expect(result.normalContentItems).toHaveLength(1);
      expect(result.linkedContentItems).toHaveLength(0);
    });
  });

  describe('linked content (has linked references)', () => {
    it('classifies an item with a contentid pattern in a Content field as linked', async () => {
      const model = makeModel('Page', [{ name: 'RelatedPost', type: 'Content' }]);
      const item = makeContentItem('Page', { relatedPost: { contentid: 42 } });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.linkedContentItems).toHaveLength(1);
      expect(result.normalContentItems).toHaveLength(0);
    });

    it('classifies an item with a contentID pattern in a Content field as linked', async () => {
      const model = makeModel('Page', [{ name: 'RelatedPost', type: 'Content' }]);
      const item = makeContentItem('Page', { relatedPost: { contentID: 99 } });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.linkedContentItems).toHaveLength(1);
    });

    it('classifies an item with a sortids pattern in a Content field as linked', async () => {
      const model = makeModel('Category', [{ name: 'Items', type: 'Content' }]);
      const item = makeContentItem('Category', { items: { sortids: '1,2,3' } });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.linkedContentItems).toHaveLength(1);
    });

    it('classifies an item with a referencename pattern in a Content field as linked', async () => {
      const model = makeModel('Product', [{ name: 'Tags', type: 'Content' }]);
      const item = makeContentItem('Product', { tags: { referencename: 'tag-list' } });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.linkedContentItems).toHaveLength(1);
    });

    it('detects direct nested contentid references in a model that has a Content-type field', async () => {
      // The direct-scan path is only reached when the model has at least one Content field
      const model = makeModel('Widget', [
        { name: 'Data', type: 'Text' },
        { name: 'Placeholder', type: 'Content' },
      ]);
      const item = makeContentItem('Widget', {
        placeholder: null,
        data: { nested: { contentid: 7 } },
      });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.linkedContentItems).toHaveLength(1);
    });

    it('detects direct nested contentID (numeric) references in a model with a Content-type field', async () => {
      // The direct-scan path is only reached when the model has at least one Content field
      const model = makeModel('Widget', [
        { name: 'Placeholder', type: 'Content' },
      ]);
      const item = makeContentItem('Widget', {
        placeholder: null,
        extra: { contentID: 15 },
      });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.linkedContentItems).toHaveLength(1);
    });

    it('does not flag a string contentID value as a linked reference', async () => {
      const model = makeModel('Widget', [{ name: 'Data', type: 'Text' }]);
      const item = makeContentItem('Widget', {
        data: { contentID: 'not-a-number' },
      });
      const result = await classifier.classifyContent([item], [model]);
      expect(result.normalContentItems).toHaveLength(1);
    });
  });

  describe('mixed batches', () => {
    it('correctly partitions a mixed batch of normal and linked items', async () => {
      const model = makeModel('Post', [{ name: 'Related', type: 'Content' }]);
      const normalItem = makeContentItem('Post', { related: null, title: 'plain' });
      const linkedItem = makeContentItem('Post', { related: { contentid: 5 } });
      const result = await classifier.classifyContent([normalItem, linkedItem], [model]);
      expect(result.normalContentItems).toHaveLength(1);
      expect(result.linkedContentItems).toHaveLength(1);
    });
  });

  describe('classificationDetails accuracy', () => {
    it('reports correct counts in classificationDetails', async () => {
      const model = makeModel('Post', [{ name: 'Link', type: 'Content' }]);
      const items = [
        makeContentItem('Post', { link: { contentid: 1 } }),
        makeContentItem('Post', { link: null }),
        makeContentItem('Post', { link: null }),
      ];
      const result = await classifier.classifyContent(items, [model]);
      expect(result.classificationDetails.totalItems).toBe(3);
      expect(result.classificationDetails.linkedCount).toBe(1);
      expect(result.classificationDetails.normalCount).toBe(2);
    });

    it('records a non-negative analysisTime', async () => {
      const result = await classifier.classifyContent([], []);
      expect(result.classificationDetails.analysisTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('model field caching', () => {
    it('produces consistent results when the same model is used for multiple items', async () => {
      const model = makeModel('Cached', [{ name: 'Ref', type: 'Content' }]);
      const items = Array.from({ length: 3 }, (_, i) =>
        makeContentItem('Cached', { ref: { contentid: i + 1 } })
      );
      const result = await classifier.classifyContent(items, [model]);
      expect(result.linkedContentItems).toHaveLength(3);
    });
  });
});

// ─── clearCache ───────────────────────────────────────────────────────────────

describe('ContentClassifier.clearCache', () => {
  it('does not throw when the cache is empty', () => {
    const classifier = new ContentClassifier();
    expect(() => classifier.clearCache()).not.toThrow();
  });

  it('does not throw after classifying content (cache is populated)', async () => {
    const classifier = new ContentClassifier();
    const model = makeModel('M', [{ name: 'F', type: 'Text' }]);
    await classifier.classifyContent([makeContentItem('M', {})], [model]);
    expect(() => classifier.clearCache()).not.toThrow();
  });
});

// ─── getClassificationStats ───────────────────────────────────────────────────

describe('ContentClassifier.getClassificationStats', () => {
  let classifier: ContentClassifier;

  beforeEach(() => {
    classifier = new ContentClassifier();
  });

  it('returns a string containing the normal and linked counts', async () => {
    const model = makeModel('P', [{ name: 'Link', type: 'Content' }]);
    const items = [
      makeContentItem('P', { link: { contentid: 1 } }),
      makeContentItem('P', { link: null }),
    ];
    const classification = await classifier.classifyContent(items, [model]);
    const stats = classifier.getClassificationStats(classification);
    expect(stats).toContain('1 normal');
    expect(stats).toContain('1 linked');
    expect(stats).toContain('2 total');
  });

  it('includes percentage values in the stats string', async () => {
    const classification = {
      normalContentItems: [],
      linkedContentItems: [],
      classificationDetails: {
        totalItems: 4,
        normalCount: 3,
        linkedCount: 1,
        analysisTime: 5,
      },
    };
    const stats = classifier.getClassificationStats(classification);
    expect(stats).toContain('75%');
    expect(stats).toContain('25%');
  });
});
