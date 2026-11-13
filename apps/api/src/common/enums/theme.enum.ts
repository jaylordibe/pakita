// A theme's choices. The desktop app bundles every font and draws every
// background itself, so presenting needs no network; a new value here needs
// the desktop to support it (it maps each value exhaustively). No migration:
// the columns are plain text.

export enum ThemeBackground {
  /** The theme's `backgroundColor`. */
  SOLID = 'solid',
  DUSK = 'dusk',
  DAWN = 'dawn',
  OCEAN = 'ocean',
  FOREST = 'forest',
  SLATE = 'slate',
}

export enum ThemeFont {
  SANS = 'sans',
  SERIF = 'serif',
  ROUNDED = 'rounded',
  CONDENSED = 'condensed',
}

export enum ThemeTextAlign {
  CENTER = 'center',
  LEFT = 'left',
}
