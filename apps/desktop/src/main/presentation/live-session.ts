import type { LiveState, Slide } from '../../shared/ipc-contract';

type ProjectorStatus = LiveState['projector'];

/**
 * What is being presented: a deck of slides fixed when the presentation
 * starts, the current slide and blackout.
 *
 * The deck is a copy taken from the local database once, at `start`. Nothing
 * else — synchronisation included — can replace it: changed content reaches
 * the screen only when the operator starts that song again. Navigation is
 * clamped, so a key held down at either end of the deck is harmless.
 */
export class LiveSession {
  private title: string | null = null;
  private slides: readonly Slide[] = [];
  private index = 0;
  private isBlackout = false;

  start(title: string, slides: readonly Slide[]): void {
    this.title = title;
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

  toggleBlackout(): void {
    if (this.title === null) return;
    this.isBlackout = !this.isBlackout;
  }

  stop(): void {
    this.title = null;
    this.slides = [];
    this.index = 0;
    this.isBlackout = false;
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
      projector: this.isLive ? projector : 'off',
    };
  }
}
