import { describe, expect, it } from 'vitest';

import { bibleContentHash } from './bible-content-hash';

describe('bibleContentHash', () => {
  // The shared vector: apps/api/src/common/util/bible-content-hash.util.spec.ts
  // asserts the same hash for the same verses. Change both or neither.
  it('matches the API’s test vector', () => {
    expect(
      bibleContentHash([
        {
          bookCode: 'GEN',
          chapter: 1,
          verse: 1,
          text: 'In the beginning, God created the heavens and the earth.',
        },
        {
          bookCode: 'JHN',
          chapter: 3,
          verse: 16,
          text: 'For God so loved the world — “ñ”.',
        },
      ]),
    ).toBe('9a02c6a9d65dc18e4e4bf1584119371699360bb24beda1f8be67dc5ead869da4');
  });
});
