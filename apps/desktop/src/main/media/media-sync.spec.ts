import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Media } from '../api/api-schemas';
import { MediaFolder } from './media-folder';
import type { MediaFileState } from '../../shared/ipc-contract';
import { MediaSync } from './media-sync';

const bytesOf = (text: string) => Buffer.from(text);
function video(id: string, body: Buffer, contentType = 'video/mp4'): Media {
  return {
    id,
    workspaceId: 'workspace',
    name: id,
    kind: contentType.startsWith('image/') ? 'image' : 'video',
    sha256: createHash('sha256').update(body).digest('hex'),
    sizeBytes: body.length,
    contentType,
    width: 1920,
    height: 1080,
    durationMs: contentType.startsWith('image/') ? null : 1000,
    syncVersion: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('MediaSync', () => {
  let directory: string;
  let folder: MediaFolder;
  let bodies: Map<string, Buffer>;
  let media: Media[];
  let isLive: boolean;
  let downloads: string[];
  let published: MediaFileState[][];

  const sync = () =>
    new MediaSync({
      folder,
      listMedia: () => Promise.resolve(media),
      listAllHashes: () =>
        Promise.resolve(media.map((candidate) => candidate.sha256)),
      downloadUrl: (mediaId) =>
        Promise.resolve(`https://storage.test/${mediaId}`),
      fetchFunction: (url) => {
        const mediaId = url.split('/').at(-1)!;
        downloads.push(mediaId);
        return Promise.resolve(
          new Response(new Uint8Array(bodies.get(mediaId)!)),
        );
      },
      isLive: () => isLive,
      onChange: (states) => published.push([...states]),
    });
  const stateOf = (engine: MediaSync, mediaId: string) =>
    engine.getStates().find((state) => state.mediaId === mediaId)?.state;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pakita-media-sync-'));
    folder = new MediaFolder(directory);
    bodies = new Map([
      ['one', bytesOf('first video')],
      ['two', bytesOf('second video')],
    ]);
    media = [
      video('one', bodies.get('one')!),
      video('two', bodies.get('two')!),
    ];
    isLive = false;
    downloads = [];
    published = [];
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('downloads every video once, then holds them', async () => {
    const engine = sync();
    await engine.run();
    expect(downloads).toEqual(['one', 'two']);
    expect(stateOf(engine, 'one')).toBe('ready');
    expect(stateOf(engine, 'two')).toBe('ready');

    await engine.run();
    expect(downloads).toEqual(['one', 'two']);
  });

  it('downloads nothing during a presentation', async () => {
    isLive = true;
    const engine = sync();
    await engine.run();
    expect(downloads).toEqual([]);
    expect(stateOf(engine, 'one')).toBe('waiting');
  });

  it('skips a format this build cannot play', async () => {
    media = [video('one', bodies.get('one')!, 'video/quicktime')];
    const engine = sync();
    await engine.run();
    expect(downloads).toEqual([]);
    expect(engine.getStates()).toEqual([]);
  });

  it('does not download again a video that failed verification, until told to', async () => {
    bodies.set('one', bytesOf('first VIDEO'));
    const engine = sync();
    await engine.run();
    expect(stateOf(engine, 'one')).toBe('failed');
    expect(engine.getStates()[0]?.message).toContain('checksum');

    await engine.run();
    expect(downloads.filter((id) => id === 'one')).toHaveLength(1);

    engine.forgetRejections();
    await engine.run();
    expect(downloads.filter((id) => id === 'one')).toHaveLength(2);
  });

  it('removes the file of a video the workspace deleted', async () => {
    const engine = sync();
    await engine.run();
    const removed = media[1]!;
    media = [media[0]!];
    await engine.run();
    expect(await folder.has({ ...removed, contentType: 'video/mp4' })).toBe(
      false,
    );
    expect(engine.getStates().map((state) => state.mediaId)).toEqual(['one']);
  });

  it('downloads still images as it does videos', async () => {
    bodies.set('still', bytesOf('a still image'));
    media = [video('still', bodies.get('still')!, 'image/png')];
    const engine = sync();
    await engine.run();
    expect(stateOf(engine, 'still')).toBe('ready');
    expect(
      await folder.has({ sha256: media[0]!.sha256, contentType: 'image/png' }),
    ).toBe(true);
  });
});
