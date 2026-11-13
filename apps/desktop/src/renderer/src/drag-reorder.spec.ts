import { describe, expect, it } from 'vitest';

import { moveItem, reorderTarget } from './drag-reorder';

describe('reorderTarget', () => {
  it('moves an item down when dropped after a later one', () => {
    expect(reorderTarget(0, 2, 'after')).toBe(2);
    expect(reorderTarget(0, 2, 'before')).toBe(1);
  });

  it('moves an item up when dropped before an earlier one', () => {
    expect(reorderTarget(3, 1, 'before')).toBe(1);
    expect(reorderTarget(3, 1, 'after')).toBe(2);
  });

  it('changes nothing when dropped beside itself', () => {
    expect(reorderTarget(2, 2, 'before')).toBeNull();
    expect(reorderTarget(2, 2, 'after')).toBeNull();
    expect(reorderTarget(2, 1, 'after')).toBeNull();
    expect(reorderTarget(2, 3, 'before')).toBeNull();
  });
});

describe('moveItem', () => {
  it('returns a reordered copy', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores a position outside the list', () => {
    expect(moveItem(['a', 'b'], 0, 2)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });
});
