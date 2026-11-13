import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_LOOK } from '../../shared/theme-look';
import { LiveSession } from './live-session';

const look = { ...DEFAULT_THEME_LOOK, background: 'ocean' as const };

const slides = [
  { sectionLabel: 'Verse 1', text: 'One' },
  { sectionLabel: 'Verse 1', text: 'Two' },
  { sectionLabel: 'Chorus', text: 'Three' },
];

describe('LiveSession', () => {
  it('starts on the first slide, not blacked out', () => {
    const session = new LiveSession();
    session.start('Song', slides, look);
    expect(session.snapshot('showing')).toMatchObject({
      isLive: true,
      title: 'Song',
      index: 0,
      isBlackout: false,
      look,
      projector: 'showing',
    });
  });

  it('clamps navigation at both ends', () => {
    const session = new LiveSession();
    session.start('Song', slides, look);
    session.previous();
    expect(session.snapshot('showing').index).toBe(0);
    session.next();
    session.next();
    session.next();
    expect(session.snapshot('showing').index).toBe(2);
    session.goTo(-5);
    expect(session.snapshot('showing').index).toBe(0);
    session.goTo(99);
    expect(session.snapshot('showing').index).toBe(2);
  });

  it('keeps its own copy of the deck', () => {
    const session = new LiveSession();
    const mutableSlides = slides.map((slide) => ({ ...slide }));
    session.start('Song', mutableSlides, look);
    mutableSlides[0]!.text = 'Changed after start';
    mutableSlides.push({ sectionLabel: 'X', text: 'Added' });

    const state = session.snapshot('showing');
    expect(state.slides[0]?.text).toBe('One');
    expect(state.slides).toHaveLength(3);
    expect(Object.isFrozen(state.slides)).toBe(true);
  });

  it('toggles blackout only while live, and stop clears everything', () => {
    const session = new LiveSession();
    session.toggleBlackout();
    expect(session.snapshot('off').isBlackout).toBe(false);

    session.start('Song', slides, look);
    session.toggleBlackout();
    expect(session.snapshot('showing').isBlackout).toBe(true);
    session.stop();
    expect(session.snapshot('showing')).toEqual({
      isLive: false,
      title: null,
      slides: [],
      index: 0,
      isBlackout: false,
      look: DEFAULT_THEME_LOOK,
      projector: 'off',
    });
  });
});
