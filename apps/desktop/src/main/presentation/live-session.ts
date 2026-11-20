import type { LiveState, Slide } from '../../shared/ipc-contract';
import { DEFAULT_THEME_LOOK, type ThemeLook } from '../../shared/theme-look';

type ProjectorStatus = LiveState['projector'];

/**
 * What is being presented: a deck of slides fixed when the presentation
 * starts, the current slide and blackout.
 *
 * The deck — and the theme it is drawn with — is a copy taken from the local
 * database once, at `start`. Nothing else — synchronisation included — can
 * replace it: changed content reaches the screen only when the operator
 * starts that song again. The one change made while live is the operator's
 * own: `changeLook`, a theme chosen in the live bar, which lasts until
 * `stop`. Navigation is clamped, so a key held down at either end of the
 * deck is harmless.
 */
export class LiveSession {
  private title: string | null = null;
  private slides: readonly Slide[] = [];
  private index = 0;
  private isBlackout = false;
  private look: ThemeLook = DEFAULT_THEME_LOOK;
  private themeId: string | null = null;

  /** `themeId`: the theme the look came from; null for the built-in one. */
  start(
    title: string,
    slides: readonly Slide[],
    look: ThemeLook,
    themeId: string | null,
  ): void {
    this.title = title;
    this.look = Object.freeze({ ...look });
    this.themeId = themeId;
    this.slides = Object.freeze(
      slides.map((slide) => Object.freeze({ ...slide })),
    );
    this.index = 0;
    this.isBlackout = false;
  }

  next(): void {
    this.goTo(this.index + 1);
  }

  previous(): void {
    this.goTo(this.index - 1);
  }

  goTo(index: number): void {
    if (this.slides.length === 0) return;
    this.index = Math.min(Math.max(index, 0), this.slides.length - 1);
  }

  /**
   * Draws the same deck, at the same slide, with another theme the operator
   * chose. Only while presenting; it ends with the presentation.
   */
  changeLook(look: ThemeLook, themeId: string): void {
    if (this.title === null) return;
    this.look = Object.freeze({ ...look });
    this.themeId = themeId;
  }

  toggleBlackout(): void {
    if (this.title === null) return;
    this.isBlackout = !this.isBlackout;
  }

  stop(): void {
    this.title = null;
    this.slides = [];
    this.index = 0;
    this.isBlackout = false;
    this.look = DEFAULT_THEME_LOOK;
    this.themeId = null;
  }

  get isLive(): boolean {
    return this.title !== null;
  }

  snapshot(projector: ProjectorStatus): LiveState {
    return {
      isLive: this.isLive,
      title: this.title,
      slides: this.slides,
      index: this.index,
      isBlackout: this.isBlackout,
      look: this.look,
      themeId: this.themeId,
      projector: this.isLive ? projector : 'off',
    };
  }
}
