import { createBatches } from '../batch-workflows';

// ─── createBatches ────────────────────────────────────────────────────────────

describe('createBatches', () => {
  it('splits an array into batches of the specified size', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const batches = createBatches(items, 3);
    expect(batches).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('uses default batch size of 250 when not specified', () => {
    const items = Array.from({ length: 300 }, (_, i) => i);
    const batches = createBatches(items);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(250);
    expect(batches[1]).toHaveLength(50);
  });

  it('returns a single batch when items fit within batch size', () => {
    const items = [1, 2, 3];
    const batches = createBatches(items, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([1, 2, 3]);
  });

  it('returns an empty array when input is empty', () => {
    expect(createBatches([], 10)).toEqual([]);
  });

  it('returns one batch per item when batch size is 1', () => {
    const items = ['a', 'b', 'c'];
    const batches = createBatches(items, 1);
    expect(batches).toEqual([['a'], ['b'], ['c']]);
  });

  it('works with a batch size equal to the array length', () => {
    const items = [10, 20, 30];
    const batches = createBatches(items, 3);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([10, 20, 30]);
  });

  it('works with object arrays', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const batches = createBatches(items, 2);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual([{ id: 1 }, { id: 2 }]);
    expect(batches[1]).toEqual([{ id: 3 }]);
  });

  it('preserves item order', () => {
    const items = Array.from({ length: 10 }, (_, i) => i * 10);
    const batches = createBatches(items, 4);
    const flattened = batches.flat();
    expect(flattened).toEqual(items);
  });

  it('does not mutate the original array', () => {
    const items = [1, 2, 3, 4, 5];
    const original = [...items];
    createBatches(items, 2);
    expect(items).toEqual(original);
  });

  it('each batch is a new array (not a reference to input)', () => {
    const items = [1, 2, 3];
    const batches = createBatches(items, 3);
    batches[0].push(999);
    expect(items).toEqual([1, 2, 3]);
  });
});
