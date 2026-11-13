import { describe, expect, it } from 'vitest';

import { themeBackgroundValues, themeFontValues } from './api/enums';
import { DEFAULT_THEME_LOOK, stageStyle } from './theme-look';

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
