// How slide text is sized: as large as it starts, then 8% smaller at a time
// until it fits. The projector and the operator's slide previews both use
// this, so a preview wraps and shrinks the way the screen will.

/** The starting size for a slide area: a share of its width and height. */
export function startingTextSize(width: number, height: number): number {
  return Math.min(width / 14, height / 7);
}

/**
 * The size, from `start` down to no less than `min`, at which `fits` (which
 * applies the size and measures) first holds.
 */
export function fitTextSize(
  start: number,
  min: number,
  fits: (size: number) => boolean,
): number {
  let size = start;
  while (size > min && !fits(size)) size *= 0.92;
  return size;
}
