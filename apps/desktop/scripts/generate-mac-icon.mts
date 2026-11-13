// Derives the macOS app icon (build/icon-mac.png) from the one source mark,
// build/icon.png. macOS expects an icon drawn on Apple's icon grid: an
// 824-pixel rounded square centred on a 1024 canvas, leaving room for the
// system's shadow. A bare cutout that fills the canvas looks oversized in the
// Dock, and recent macOS versions put it inside a grey plate. Windows and Linux
// use the cutout as it is.
//
// Run `pnpm generate:mac-icon` after changing build/icon.png;
// scripts/mac-icon.spec.ts fails while the two disagree.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const CANVAS = 1024;
const PLATE = 824;
const PLATE_OFFSET = (CANVAS - PLATE) / 2;
const PLATE_RADIUS = 185;
// The mark fills at most this share of the plate, so it keeps clear space.
const MARK_BOX = 600;

export const SOURCE = fileURLToPath(
  new URL('../build/icon.png', import.meta.url),
);
export const OUTPUT = fileURLToPath(
  new URL('../build/icon-mac.png', import.meta.url),
);

const plate =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#eeeafc"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="${PLATE_OFFSET}" y="${PLATE_OFFSET}" width="${PLATE}" height="${PLATE}"
        rx="${PLATE_RADIUS}" fill="url(#fill)" filter="url(#shadow)"/>
</svg>`);

/** The macOS icon as PNG bytes. */
export async function renderMacIcon(): Promise<Buffer> {
  const mark = await sharp(SOURCE)
    .trim()
    .resize(MARK_BOX, MARK_BOX, { fit: 'inside' })
    .png()
    .toBuffer();
  const { width, height } = await sharp(mark).metadata();
  return sharp(plate)
    .composite([
      {
        input: mark,
        left: Math.round((CANVAS - width) / 2),
        top: Math.round((CANVAS - height) / 2),
      },
    ])
    .png()
    .toBuffer();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await sharp(await renderMacIcon()).toFile(OUTPUT);
  console.log(`Wrote ${OUTPUT}`);
}
