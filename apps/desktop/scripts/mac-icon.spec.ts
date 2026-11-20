import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { OUTPUT, renderMacIcon } from './generate-mac-icon.mjs';

// libvips resamples with the CPU's own SIMD code, so the same render differs
// by a rounding step from one processor to another: on x86-64 CI, 28 of
// 4,194,304 channels by 1 against an icon rendered on arm64. A stale icon
// differs far more than that; rounding never does.
const ROUNDING_TOLERANCE = 2;

async function pixels(png: Buffer) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

describe('build/icon-mac.png', () => {
  it('is derived from build/icon.png (run `pnpm generate:mac-icon`)', async () => {
    const committed = await pixels(await readFile(OUTPUT));
    const derived = await pixels(await renderMacIcon());
    expect([committed.info.width, committed.info.height]).toEqual([
      derived.info.width,
      derived.info.height,
    ]);
    let largestDifference = 0;
    for (let index = 0; index < committed.data.length; index += 1) {
      largestDifference = Math.max(
        largestDifference,
        Math.abs(committed.data[index]! - derived.data[index]!),
      );
    }
    expect(largestDifference).toBeLessThanOrEqual(ROUNDING_TOLERANCE);
  });
});
