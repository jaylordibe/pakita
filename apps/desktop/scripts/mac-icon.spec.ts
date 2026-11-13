import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { OUTPUT, renderMacIcon } from './generate-mac-icon.mjs';

async function pixels(png: Buffer): Promise<Buffer> {
  return sharp(png).ensureAlpha().raw().toBuffer();
}

describe('build/icon-mac.png', () => {
  it('is derived from build/icon.png (run `pnpm generate:mac-icon`)', async () => {
    const committed = await pixels(await readFile(OUTPUT));
    const derived = await pixels(await renderMacIcon());
    expect(committed.equals(derived)).toBe(true);
  });
});
