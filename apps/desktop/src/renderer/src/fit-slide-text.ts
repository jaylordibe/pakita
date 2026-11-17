import type { Directive } from 'vue';

import { fitTextSize, startingTextSize } from '../../shared/fit-text';

// `v-fit-slide-text` on a `.slide-text` sizes it the way the projector sizes
// a slide: large, then smaller until it fits its slide, so a preview shows
// how the lines will wrap and how small they get, and never spills over the
// slide's label. Refits when the text changes or the slide is resized.

const SMALLEST = 4;
const observers = new WeakMap<HTMLElement, ResizeObserver>();

function fit(text: HTMLElement): void {
  const slide = text.parentElement;
  if (!slide) return;
  const style = getComputedStyle(slide);
  const width =
    slide.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  const height =
    slide.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);
  if (width <= 0 || height <= 0) return;
  fitTextSize(startingTextSize(width, height), SMALLEST, (size) => {
    text.style.fontSize = `${size}px`;
    return text.scrollHeight <= height && text.scrollWidth <= width;
  });
}

export const vFitSlideText: Directive<HTMLElement> = {
  mounted(text) {
    text.classList.add('is-fitted');
    const observer = new ResizeObserver(() => fit(text));
    if (text.parentElement) observer.observe(text.parentElement);
    observers.set(text, observer);
    fit(text);
  },
  updated(text) {
    fit(text);
  },
  unmounted(text) {
    observers.get(text)?.disconnect();
    observers.delete(text);
  },
};
