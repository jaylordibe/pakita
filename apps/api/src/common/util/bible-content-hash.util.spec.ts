import { bibleContentHash } from './bible-content-hash.util';

// The shared test vector: apps/desktop/src/main/bible/bible-content-hash.spec.ts
// asserts the same hash for the same verses. Change both or neither.
const BIBLE_HASH_TEST_VECTOR = {
  verses: [
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
  ],
  hash: '9a02c6a9d65dc18e4e4bf1584119371699360bb24beda1f8be67dc5ead869da4',
};

describe('bibleContentHash', () => {
  it('matches the shared test vector', () => {
    expect(bibleContentHash(BIBLE_HASH_TEST_VECTOR.verses)).toBe(
      BIBLE_HASH_TEST_VECTOR.hash,
    );
  });

  it('depends on every field and the order', () => {
    const base = bibleContentHash(BIBLE_HASH_TEST_VECTOR.verses);
    const [first, second] = BIBLE_HASH_TEST_VECTOR.verses;
    expect(bibleContentHash([second!, first!])).not.toBe(base);
    expect(bibleContentHash([{ ...first!, verse: 2 }, second!])).not.toBe(base);
    expect(
      bibleContentHash([{ ...first!, text: `${first!.text} ` }, second!]),
    ).not.toBe(base);
  });
});
