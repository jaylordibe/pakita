import { describe, expect, it } from 'vitest';

import { kindName, nameForKind, sectionsInSungOrder } from './song-sections';

describe('kindName', () => {
  it('capitalises the kind', () => {
    expect(kindName('verse')).toBe('Verse');
    expect(kindName('chorus')).toBe('Chorus');
  });
});

describe('nameForKind', () => {
  it('follows the kind while the name is just the kind', () => {
    expect(nameForKind('Verse', 'verse', 'chorus')).toBe('Chorus');
    expect(nameForKind(' Verse ', 'verse', 'bridge')).toBe('Bridge');
  });

  it('names an unnamed section after its new kind', () => {
    expect(nameForKind('', 'verse', 'chorus')).toBe('Chorus');
  });

  it('keeps a name the person typed', () => {
    expect(nameForKind('Verse 1', 'verse', 'chorus')).toBe('Verse 1');
    expect(nameForKind('Final chorus', 'chorus', 'outro')).toBe('Final chorus');
  });
});

describe('sectionsInSungOrder', () => {
  const sections = ['v1', 'c1', 'v2', 'br'].map((key) => ({ key }));
  const keysOf = (list: Array<{ key: string }>) => list.map(({ key }) => key);

  it('lists each section once, where it is first sung', () => {
    expect(
      keysOf(sectionsInSungOrder(sections, ['c1', 'v1', 'c1', 'v2', 'c1'])),
    ).toEqual(['c1', 'v1', 'v2', 'br']);
  });

  it('keeps a section that is not sung, after the sung ones', () => {
    expect(keysOf(sectionsInSungOrder(sections, ['v2', 'v1']))).toEqual([
      'v2',
      'v1',
      'c1',
      'br',
    ]);
  });

  it('ignores a key that names no section', () => {
    expect(keysOf(sectionsInSungOrder(sections, ['gone', 'br']))).toEqual([
      'br',
      'v1',
      'c1',
      'v2',
    ]);
  });
});
