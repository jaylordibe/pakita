import { describe, expect, it } from 'vitest';

import {
  automaticLabel,
  isAutomaticLabel,
  kindName,
  type SectionKind,
} from './song-sections';

const section = (kind: SectionKind, label: string) => ({ kind, label });

describe('kindName', () => {
  it('capitalises the kind', () => {
    expect(kindName('verse')).toBe('Verse');
    expect(kindName('chorus')).toBe('Chorus');
  });
});

describe('automaticLabel', () => {
  it('numbers each kind on its own', () => {
    expect(automaticLabel('verse', [])).toBe('Verse 1');
    expect(
      automaticLabel('verse', [
        section('verse', 'Verse 1'),
        section('chorus', 'Chorus 1'),
      ]),
    ).toBe('Verse 2');
    expect(automaticLabel('bridge', [section('verse', 'Verse 1')])).toBe(
      'Bridge 1',
    );
  });

  it('goes past the highest number in use, so no two sections share a name', () => {
    expect(
      automaticLabel('verse', [
        section('verse', 'Verse 3'),
        section('verse', 'Verse 1'),
      ]),
    ).toBe('Verse 4');
  });

  it('counts every section of the kind, whatever it is called', () => {
    expect(
      automaticLabel('chorus', [
        section('verse', 'Verse 1'),
        section('chorus', 'Final chorus'),
      ]),
    ).toBe('Chorus 2');
    expect(
      automaticLabel('verse', [
        section('verse', 'Verse 1'),
        section('verse', 'Last verse'),
        section('chorus', 'Chorus 1'),
      ]),
    ).toBe('Verse 3');
  });
});

describe('isAutomaticLabel', () => {
  it('recognises only the kind’s own automatic name', () => {
    expect(isAutomaticLabel('Verse 2', 'verse')).toBe(true);
    expect(isAutomaticLabel(' Verse 2 ', 'verse')).toBe(true);
    expect(isAutomaticLabel('Verse 2', 'chorus')).toBe(false);
    expect(isAutomaticLabel('Verse 2b', 'verse')).toBe(false);
    expect(isAutomaticLabel('Section 4', 'verse')).toBe(false);
  });
});
