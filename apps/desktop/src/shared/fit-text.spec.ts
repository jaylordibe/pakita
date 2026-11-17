import { describe, expect, it } from 'vitest';

import { fitTextSize, startingTextSize } from './fit-text';

describe('fitTextSize', () => {
  it('keeps the starting size when it fits', () => {
    expect(fitTextSize(100, 12, () => true)).toBe(100);
  });

  it('shrinks 8% at a time until it fits', () => {
    expect(fitTextSize(100, 12, (size) => size <= 85)).toBeCloseTo(84.64);
  });

  it('stops at the smallest size even when nothing fits', () => {
    const size = fitTextSize(100, 12, () => false);
    expect(size).toBeLessThanOrEqual(12);
    expect(size).toBeGreaterThan(12 * 0.92);
  });
});

describe('startingTextSize', () => {
  it('is the smaller of a fourteenth of the width and a seventh of the height', () => {
    expect(startingTextSize(1400, 1000)).toBe(100);
    expect(startingTextSize(1400, 350)).toBe(50);
  });
});
