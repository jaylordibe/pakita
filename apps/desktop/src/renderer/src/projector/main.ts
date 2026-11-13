import '../fonts.css';
import './projector.css';

import type { LiveState } from '../../../shared/ipc-contract';
import { stageStyle } from '../../../shared/theme-look';

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
  const style = stageStyle(state.look);
  stage.style.background = isDark ? '#000' : style.background;
  stage.style.color = style.color;
  stage.style.fontFamily = style.fontFamily;
  stage.style.textAlign = style.textAlign;
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
  let size =
    Math.min(window.innerWidth / 14, window.innerHeight / 7) * textScale;
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
// A theme's font loads on first use: measure again with its real metrics.
document.fonts.addEventListener('loadingdone', fitText);
window.pakitaProjector.onState(render);
void window.pakitaProjector.getState().then(render);
