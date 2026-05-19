import { resetState, setState } from 'core/state';
import { extractBatchResults, logBatchError } from '../batch-polling';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── extractBatchResults — no batch items returned ────────────────────────────

describe('extractBatchResults — no items in batch', () => {
  it('marks all originalItems as failed when batch has no items array', () => {
    const originals = [{ contentID: 1 }, { contentID: 2 }];
    const result = extractBatchResults({}, originals);

    expect(result.failedItems).toHaveLength(2);
    expect(result.successfulItems).toHaveLength(0);
    result.failedItems.forEach((f) => {
      expect(f.error).toBe('No batch items returned');
    });
  });

  it('marks all originalItems as failed when batch.items is null', () => {
    const originals = [{ contentID: 1 }];
    const result = extractBatchResults({ items: null }, originals);

    expect(result.failedItems).toHaveLength(1);
    expect(result.successfulItems).toHaveLength(0);
  });

  it('returns empty summary when batch has no totalItems field', () => {
    const result = extractBatchResults({}, []);
    expect(result.summary).toBeUndefined();
  });
});

// ─── extractBatchResults — legacy items array (happy path) ────────────────────

describe('extractBatchResults — legacy items array', () => {
  it('classifies items with itemID > 0 as successful', () => {
    const batch = {
      items: [
        { itemID: 101, processedItemVersionID: 1 },
        { itemID: 102, processedItemVersionID: 1 },
      ],
    };
    const originals = [{ contentID: 1 }, { contentID: 2 }];
    const result = extractBatchResults(batch, originals);

    expect(result.successfulItems).toHaveLength(2);
    expect(result.failedItems).toHaveLength(0);
    expect(result.successfulItems[0].newId).toBe(101);
    expect(result.successfulItems[1].newId).toBe(102);
  });

  it('preserves originalItem reference in successful items', () => {
    const original = { contentID: 99 };
    const batch = { items: [{ itemID: 200, processedItemVersionID: 1 }] };
    const result = extractBatchResults(batch, [original]);

    expect(result.successfulItems[0].originalItem).toBe(original);
  });

  it('classifies items with itemID <= 0 as failed', () => {
    const batch = { items: [{ itemID: 0 }] };
    const originals = [{ contentID: 1 }];
    const result = extractBatchResults(batch, originals);

    expect(result.failedItems).toHaveLength(1);
    expect(result.successfulItems).toHaveLength(0);
  });

  it('uses errorMessage from item when available', () => {
    const batch = {
      items: [{ itemID: 0, errorMessage: '{"message":"field too long"}' }],
    };
    const result = extractBatchResults(batch, [{ contentID: 1 }]);

    expect(result.failedItems[0].error).toBe('field too long');
  });

  it('uses fallback error message when errorMessage is absent', () => {
    const batch = { items: [{ itemID: -1 }] };
    const result = extractBatchResults(batch, [{ contentID: 1 }]);

    expect(result.failedItems[0].error).toContain('Invalid ID');
  });

  it('marks item as failed when itemNull is set even if itemID > 0', () => {
    const batch = { items: [{ itemID: 5, itemNull: true }] };
    const result = extractBatchResults(batch, [{ contentID: 1 }]);

    expect(result.failedItems).toHaveLength(1);
    expect(result.successfulItems).toHaveLength(0);
  });
});

// ─── extractBatchResults — structured failedItems (new API) ───────────────────

describe('extractBatchResults — structured failedItems array', () => {
  it('uses failedItems array from new API when present', () => {
    const batch = {
      failedItems: [
        { batchItemId: 1, errorMessage: 'Validation error', errorType: 'ValidationException', itemType: 'Content' },
      ],
      items: [
        { itemID: 0, batchItemID: 1 },
      ],
    };
    const originals = [{ contentID: 10 }];
    const result = extractBatchResults(batch, originals);

    expect(result.failedItems).toHaveLength(1);
    expect(result.failedItems[0].error).toBe('Validation error');
    expect(result.failedItems[0].errorType).toBe('ValidationException');
    expect(result.failedItems[0].itemType).toBe('Content');
  });

  it('marks remaining items as successful when failedItems array is present and items exist', () => {
    const batch = {
      failedItems: [
        { batchItemId: 1, errorMessage: 'error', errorType: 'Error', itemType: 'Content' },
      ],
      items: [
        { itemID: 0, batchItemID: 1 },
        { itemID: 200, batchItemID: 2 },
      ],
    };
    const originals = [{ contentID: 1 }, { contentID: 2 }];
    const result = extractBatchResults(batch, originals);

    expect(result.successfulItems).toHaveLength(1);
    expect(result.successfulItems[0].newId).toBe(200);
    expect(result.failedItems).toHaveLength(1);
  });

  it('supports PascalCase batchItemID in failedItems', () => {
    const batch = {
      failedItems: [
        { batchItemID: 1, errorMessage: 'bad field', errorType: 'Error', itemType: 'Content' },
      ],
    };
    const result = extractBatchResults(batch, [{ contentID: 1 }]);

    expect(result.failedItems[0].batchItemId).toBe(1);
  });
});

// ─── extractBatchResults — summary field ──────────────────────────────────────

describe('extractBatchResults — summary', () => {
  it('includes summary when batch has totalItems', () => {
    const batch = {
      totalItems: 3,
      successCount: 2,
      failureCount: 1,
      durationMs: 500,
      items: [
        { itemID: 1, processedItemVersionID: 1 },
        { itemID: 2, processedItemVersionID: 1 },
        { itemID: 0 },
      ],
    };
    const originals = [{ contentID: 1 }, { contentID: 2 }, { contentID: 3 }];
    const result = extractBatchResults(batch, originals);

    expect(result.summary).toBeDefined();
    expect(result.summary!.totalItems).toBe(3);
    expect(result.summary!.successCount).toBe(2);
    expect(result.summary!.failureCount).toBe(1);
    expect(result.summary!.durationMs).toBe(500);
  });

  it('defaults successCount and failureCount to 0 when missing from batch', () => {
    const batch = { totalItems: 1, items: [{ itemID: 50, processedItemVersionID: 1 }] };
    const result = extractBatchResults(batch, [{ contentID: 1 }]);

    expect(result.summary!.successCount).toBe(0);
    expect(result.summary!.failureCount).toBe(0);
  });
});

// ─── extractBatchResults — empty originalItems edge cases ─────────────────────

describe('extractBatchResults — edge cases', () => {
  it('handles empty originals array without throwing', () => {
    const batch = { items: [] };
    expect(() => extractBatchResults(batch, [])).not.toThrow();
  });

  it('returns empty results for empty batch and empty originals', () => {
    const result = extractBatchResults({ items: [] }, []);
    expect(result.successfulItems).toHaveLength(0);
    expect(result.failedItems).toHaveLength(0);
  });
});

// ─── logBatchError ─────────────────────────────────────────────────────────────

describe('logBatchError', () => {
  it('logs error message for a failed batch item', () => {
    const consoleSpy = jest.spyOn(console, 'error');
    logBatchError({ itemID: 0, errorMessage: 'Something went wrong' }, 0);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Item 0')
    );
  });

  it('logs batch item details', () => {
    const consoleSpy = jest.spyOn(console, 'log');
    logBatchError({ itemID: 5, errorMessage: 'error' }, 0);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Batch Item Details')
    );
  });

  it('does not throw when called without originalPayload', () => {
    expect(() => logBatchError({ itemID: 1, errorMessage: 'error' }, 0)).not.toThrow();
  });

  it('logs originalPayload when provided', () => {
    const consoleSpy = jest.spyOn(console, 'log');
    const payload = { contentID: 42, properties: { referenceName: 'test-ref' } };
    logBatchError({ itemID: 0, errorMessage: 'error' }, 0, payload);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Original Payload')
    );
  });
});
