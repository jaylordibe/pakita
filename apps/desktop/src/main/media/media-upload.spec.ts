import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PickedFiles } from './media-upload';

// The first bytes of each container, padded to a plausible file.
const MP4 = Buffer.concat([
  Buffer.from('00000018667479706973366d', 'hex'),
  Buffer.alloc(100, 1),
]);
const MOV = Buffer.concat([
  Buffer.from('0000001466747970717420200000000071742020', 'hex'),
  Buffer.alloc(100, 1),
]);
const OLD_MOV = Buffer.concat([
  Buffer.from('000000086d6f6f76', 'hex'),
  Buffer.alloc(100, 1),
]);
const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(100, 1),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

describe('PickedFiles', () => {
  let directory: string;
  let picked: PickedFiles;
  const file = (name: string, bytes: Buffer) => {
    const path = join(directory, name);
    writeFileSync(path, bytes);
    return path;
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pakita-picked-'));
    picked = new PickedFiles(join(directory, 'conversions'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('reads the container from the bytes, and names a file by token only', async () => {
    expect((await picked.add(file('a.mp4', MP4))).contentType).toBe(
      'video/mp4',
    );
    expect((await picked.add(file('b.mov', MOV))).contentType).toBe(
      'video/quicktime',
    );
    expect((await picked.add(file('c.mov', OLD_MOV))).contentType).toBe(
      'video/quicktime',
    );
    const webm = await picked.add(file('d.webm', WEBM));
    expect(webm.contentType).toBe('video/webm');
    expect(webm.url).toBe(`pakita-media://picked/${webm.token}`);
    expect(JSON.stringify(webm)).not.toContain(directory);
  });

  it('refuses what is not a video, or not what its name says', async () => {
    await expect(picked.add(file('e.mp4', PNG))).rejects.toThrow(
      'Choose an MP4, MOV or WebM video.',
    );
    await expect(picked.add(file('f.webm', MP4))).rejects.toThrow(
      'Choose an MP4, MOV or WebM video.',
    );
    await expect(picked.add(file('g.avi', MP4))).rejects.toThrow();
  });

  it('writes a converted copy chunk by chunk, then offers it as a picked file', async () => {
    const source = await picked.add(file('loop.mov', MOV));
    const output = await picked.beginOutput();
    // The converter writes the header last, at the start.
    await picked.writeOutput(output, 12, new Uint8Array(MP4.subarray(12)));
    await picked.writeOutput(output, 0, new Uint8Array(MP4.subarray(0, 12)));
    const converted = await picked.finishOutput(
      output,
      source.fileName,
      'video/mp4',
    );
    expect(converted).toMatchObject({
      fileName: 'loop.mp4',
      contentType: 'video/mp4',
      sizeBytes: MP4.length,
    });
    const path = picked.get(converted.token)!.path;
    expect(readFileSync(path)).toEqual(MP4);

    await picked.forget(converted.token);
    expect(() => readFileSync(path)).toThrow();
  });

  it('refuses a copy that would pass 1 GB, and one that is not what it claims', async () => {
    const tooFar = await picked.beginOutput();
    await expect(
      picked.writeOutput(tooFar, 1024 * 1024 * 1024 - 1, new Uint8Array(2)),
    ).rejects.toThrow('larger than 1 GB');
    await expect(
      picked.writeOutput(tooFar, 0, new Uint8Array(1)),
    ).rejects.toThrow('no longer open');

    const wrong = await picked.beginOutput();
    await picked.writeOutput(wrong, 0, new Uint8Array(WEBM));
    await expect(
      picked.finishOutput(wrong, 'loop.mov', 'video/mp4'),
    ).rejects.toThrow('could not be read back');
  });
});
