import type { components } from './api/openapi';

type Theme = components['schemas']['ThemeResponseDto'];
export type ThemeBackground = Theme['background'];
export type ThemeFont = Theme['font'];

/**
 * What the projector needs to draw a theme. Resolved once when a
 * presentation starts and held with its slides, so a theme edited or
 * deleted during a service never changes what is on screen.
 */
export interface ThemeLook {
  readonly background: ThemeBackground;
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly font: ThemeFont;
  /** Percent of the standard text size. */
  readonly textScale: number;
  readonly textAlign: Theme['textAlign'];
}

/** White text on black: used when the workspace has no default theme. */
export const DEFAULT_THEME_LOOK: ThemeLook = Object.freeze({
  background: 'solid',
  backgroundColor: '#000000',
  textColor: '#ffffff',
  font: 'sans',
  textScale: 100,
  textAlign: 'center',
});

// Every value the API allows, mapped exhaustively: a value added to the API
// fails `pnpm typecheck` here until it is drawn.
const GRADIENTS: Record<Exclude<ThemeBackground, 'solid'>, string> = {
  dusk: 'linear-gradient(160deg, #2b1a4a 0%, #6b2d5c 55%, #c0563f 100%)',
  dawn: 'linear-gradient(160deg, #f6d6a8 0%, #e89a7a 50%, #9b5e8a 100%)',
  ocean: 'linear-gradient(160deg, #06243f 0%, #0d4a6b 55%, #1b7a8c 100%)',
  forest: 'linear-gradient(160deg, #0f2417 0%, #1f4a2c 55%, #4f7a3a 100%)',
  slate: 'linear-gradient(160deg, #1b1f27 0%, #2e3542 55%, #4a5568 100%)',
};

const FONT_STACKS: Record<ThemeFont, string> = {
  sans: "'Inter', system-ui, sans-serif",
  serif: "'Merriweather', Georgia, serif",
  rounded: "'Nunito', system-ui, sans-serif",
  condensed: "'Oswald', 'Arial Narrow', sans-serif",
};

export const BACKGROUND_LABELS: Record<ThemeBackground, string> = {
  solid: 'Solid colour',
  dusk: 'Dusk',
  dawn: 'Dawn',
  ocean: 'Ocean',
  forest: 'Forest',
  slate: 'Slate',
};

export const FONT_LABELS: Record<ThemeFont, string> = {
  sans: 'Sans (Inter)',
  serif: 'Serif (Merriweather)',
  rounded: 'Rounded (Nunito)',
  condensed: 'Condensed (Oswald)',
};

export function lookOf(theme: Theme): ThemeLook {
  return Object.freeze({
    background: theme.background,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    font: theme.font,
    textScale: theme.textScale,
    textAlign: theme.textAlign,
  });
}

/** The CSS a stage (projector or preview) applies to draw a theme. */
export function stageStyle(look: ThemeLook): {
  readonly background: string;
  readonly color: string;
  readonly fontFamily: string;
  readonly textAlign: ThemeLook['textAlign'];
} {
  return {
    background:
      look.background === 'solid'
        ? look.backgroundColor
        : GRADIENTS[look.background],
    color: look.textColor,
    fontFamily: FONT_STACKS[look.font],
    textAlign: look.textAlign,
  };
}
