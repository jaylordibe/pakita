import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { parseRange, serveFile } from './media-protocol';

describe('parseRange', () => {
  it('reads a start, a start and end, and a suffix', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('serves the whole file for no range or one it does not serve', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-9', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
  });

  it('refuses a range outside the file', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=20-10', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});

describe('serveFile', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pakita-media-protocol-'));
  const path = join(directory, 'clip.webm');
  writeFileSync(path, Buffer.from('0123456789'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('answers a range with 206 and Content-Range', async () => {
    const response = await serveFile(path, 'video/webm', 'bytes=2-5');
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(response.headers.get('content-length')).toBe('4');
    expect(await response.text()).toBe('2345');
  });

  it('answers without a range with the whole file', async () => {
    const response = await serveFile(path, 'video/webm', null);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await response.text()).toBe('0123456789');
  });

  it('answers 416 outside the file, and 404 for no file', async () => {
    expect((await serveFile(path, 'video/webm', 'bytes=50-')).status).toBe(416);
    expect(
      (await serveFile(join(directory, 'missing.webm'), 'video/webm', null))
        .status,
    ).toBe(404);
  });
});
