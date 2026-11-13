import './projector.css';

import type { LiveState } from '../../../shared/ipc-contract';

const stage = document.getElementById('stage')!;
const slide = document.getElementById('slide')!;
const caption = document.getElementById('caption')!;

/**
 * Draws the current slide. Text only (`textContent`), never HTML: lyrics and
 * Bible text are content from the church server and must not become markup.
 */
function render(state: LiveState): void {
  const current = state.isLive ? state.slides[state.index] : undefined;
  const isDark = !current || state.isBlackout;
  stage.classList.toggle('is-dark', isDark);
  slide.textContent = isDark ? '' : current.text;
  caption.textContent = isDark ? '' : (current.caption ?? '');
  fitText();
}

// Shrinks the text until it fits the screen, from a large starting size.
function fitText(): void {
  caption.style.fontSize = `${Math.min(window.innerWidth / 50, window.innerHeight / 28)}px`;
  let size = Math.min(window.innerWidth / 14, window.innerHeight / 7);
  slide.style.fontSize = `${size}px`;
  while (
    size > 12 &&
    (slide.scrollHeight + caption.offsetHeight > stage.clientHeight * 0.9 ||
      slide.scrollWidth > stage.clientWidth * 0.9)
  ) {
    size *= 0.92;
    slide.style.fontSize = `${size}px`;
  }
}

window.addEventListener('resize', fitText);
window.pakitaProjector.onState(render);
void window.pakitaProjector.getState().then(render);
