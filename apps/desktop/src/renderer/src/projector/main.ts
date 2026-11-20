import '../fonts.css';
import './projector.css';

import type { LiveState } from '../../../shared/ipc-contract';
import { fitTextSize, startingTextSize } from '../../../shared/fit-text';
import { stageStyle } from '../../../shared/theme-look';

const stage = document.getElementById('stage')!;
const slide = document.getElementById('slide')!;
const caption = document.getElementById('caption')!;
const layers = [
  document.getElementById('background-a') as HTMLVideoElement,
  document.getElementById('background-b') as HTMLVideoElement,
];

const image = document.getElementById('background-image') as HTMLImageElement;
let imageUrl: string | null = null;

/**
 * Shows the theme's background image, fading in once it has loaded; a file
 * that fails to load leaves the theme's own background.
 */
function showImage(url: string | null): void {
  if (url === imageUrl) return;
  imageUrl = url;
  image.classList.remove('is-shown');
  if (!url) {
    image.removeAttribute('src');
    return;
  }
  image.onload = () => {
    if (imageUrl === url) image.classList.add('is-shown');
  };
  image.onerror = () => image.classList.remove('is-shown');
  image.src = url;
}

/** The video showing (or fading in), and which layer holds it. */
let videoUrl: string | null = null;
let front = 0;
const FADE_MILLISECONDS = 400;

/**
 * Shows the theme's background video. The same video carries on across
 * slides: only a different one (or none) changes a layer, fading the new one
 * in over the old. A layer appears only once it is playing, so a file that
 * fails to load leaves the theme's own background, never black.
 */
function showVideo(url: string | null, isDark: boolean): void {
  if (url !== videoUrl) {
    videoUrl = url;
    const previous = layers[front]!;
    const next = layers[1 - front]!;
    front = 1 - front;
    previous.classList.remove('is-shown');
    setTimeout(() => {
      // Still the layer behind once its fade-out has finished: release it.
      if (layers[front] !== previous) {
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
      }
    }, FADE_MILLISECONDS);
    next.classList.remove('is-shown');
    if (url) {
      next.src = url;
      next.onplaying = () => {
        if (layers[front] === next) next.classList.add('is-shown');
      };
      next.onerror = () => next.classList.remove('is-shown');
    }
  }
  const current = layers[front]!;
  if (!videoUrl) return;
  // Blackout pauses it; coming back resumes where it was.
  if (isDark) current.pause();
  else void current.play().catch(() => current.classList.remove('is-shown'));
}

/**
 * Draws the current slide. Text only (`textContent`), never HTML: lyrics and
 * Bible text are content from the church server and must not become markup.
 */
function render(state: LiveState): void {
  const current = state.isLive ? state.slides[state.index] : undefined;
  const isDark = !current || state.isBlackout;
  stage.classList.toggle('is-dark', isDark);
  const style = stageStyle(state.look);
  stage.style.background = isDark ? '#000' : style.background;
  stage.style.color = style.color;
  stage.style.fontFamily = style.fontFamily;
  stage.style.textAlign = style.textAlign;
  showVideo(state.isLive ? state.look.backgroundVideoUrl : null, isDark);
  showImage(state.isLive ? state.look.backgroundImageUrl : null);
  textScale = state.look.textScale / 100;
  slide.textContent = isDark ? '' : current.text;
  caption.textContent = isDark ? '' : (current.caption ?? '');
  fitText();
}

// Shrinks the text until it fits the screen, from a large starting size.
// The theme's text size, as a share of the standard starting size.
let textScale = 1;

function fitText(): void {
  caption.style.fontSize = `${Math.min(window.innerWidth / 50, window.innerHeight / 28)}px`;
  const start =
    startingTextSize(window.innerWidth, window.innerHeight) * textScale;
  fitTextSize(start, 12, (size) => {
    slide.style.fontSize = `${size}px`;
    return (
      slide.scrollHeight + caption.offsetHeight <= stage.clientHeight * 0.9 &&
      slide.scrollWidth <= stage.clientWidth * 0.9
    );
  });
}

window.addEventListener('resize', fitText);
// A theme's font loads on first use: measure again with its real metrics.
document.fonts.addEventListener('loadingdone', fitText);
window.pakitaProjector.onState(render);
void window.pakitaProjector.getState().then(render);
