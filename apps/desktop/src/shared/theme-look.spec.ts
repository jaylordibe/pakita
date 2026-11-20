import { describe, expect, it } from 'vitest';

import { themeBackgroundValues, themeFontValues } from './api/enums';
import { DEFAULT_THEME_LOOK, lookOf, stageStyle, stillOf } from './theme-look';

describe('stageStyle', () => {
  it('draws every background and font the API allows', () => {
    for (const background of themeBackgroundValues) {
      for (const font of themeFontValues) {
        const style = stageStyle({ ...DEFAULT_THEME_LOOK, background, font });
        expect(style.background).toBeTruthy();
        expect(style.fontFamily).toBeTruthy();
      }
    }
  });

  it('uses the colour for a solid background and a gradient otherwise', () => {
    expect(
      stageStyle({ ...DEFAULT_THEME_LOOK, backgroundColor: '#123456' })
        .background,
    ).toBe('#123456');
    expect(
      stageStyle({ ...DEFAULT_THEME_LOOK, background: 'ocean' }).background,
    ).toMatch(/^linear-gradient/);
  });
});

describe('a theme background on this laptop', () => {
  const theme = {
    id: 'theme',
    workspaceId: 'workspace',
    name: 'Sunday',
    background: 'solid' as const,
    backgroundColor: '#000000',
    textColor: '#ffffff',
    font: 'sans' as const,
    textScale: 100,
    textAlign: 'center' as const,
    backgroundMediaId: 'media',
    isDefault: false,
    syncVersion: 1,
    createdAt: '',
    updatedAt: '',
  };
  const sha = 'a'.repeat(64);

  it('draws a held video or image, and only the colour without one', () => {
    const video = lookOf(theme, {
      kind: 'video',
      url: `pakita-media://files/${sha}.mp4`,
    });
    expect(video.backgroundVideoUrl).toBe(`pakita-media://files/${sha}.mp4`);
    expect(video.backgroundImageUrl).toBeNull();
    const image = lookOf(theme, {
      kind: 'image',
      url: `pakita-media://files/${sha}.png`,
    });
    expect(image.backgroundImageUrl).toBe(`pakita-media://files/${sha}.png`);
    expect(image.backgroundVideoUrl).toBeNull();
    const none = lookOf(theme);
    expect([none.backgroundVideoUrl, none.backgroundImageUrl]).toEqual([
      null,
      null,
    ]);
  });

  it('previews the image itself, or the video’s still frame', () => {
    expect(
      stillOf(
        lookOf(theme, {
          kind: 'image',
          url: `pakita-media://files/${sha}.jpg`,
        }),
      ),
    ).toBe(`pakita-media://files/${sha}.jpg`);
    expect(
      stillOf(
        lookOf(theme, {
          kind: 'video',
          url: `pakita-media://files/${sha}.webm`,
        }),
      ),
    ).toBe(`pakita-media://files/${sha}.webp`);
    expect(stillOf(lookOf(theme))).toBeNull();
  });
});
