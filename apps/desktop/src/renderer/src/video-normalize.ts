import type { PickedVideo } from '../../shared/ipc-contract';

// Drives the normalising worker (video-normalize.worker.ts) for one picked
// video: reads what it is, and when it is outside the video spec, writes the
// version every laptop plays to a file the main process holds, chunk by chunk,
// so a large video never sits whole in memory.

export interface VideoReport {
  /** As Mediabunny reads it: `video/mp4`, `video/quicktime`, … */
  readonly container: string;
  readonly codec: string | null;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly frameRate: number;
  /** Whether this laptop can decode it at all. */
  readonly isDecodable: boolean;
  /** Why it must be re-encoded; empty when it is within the spec. */
  readonly transcodeReasons: readonly string[];
  /** Within the spec, but in a container to copy it out of (a .mov). */
  readonly needsRewrap: boolean;
}

export type NormalizeRequest =
  | { type: 'inspect'; url: string }
  | { type: 'normalize'; url: string; report: VideoReport }
  | { type: 'written'; id: number }
  | { type: 'cancel' };

export type NormalizeReply =
  | { type: 'report'; report: VideoReport }
  | { type: 'chunk'; id: number; position: number; data: Uint8Array }
  | { type: 'progress'; progress: number }
  | { type: 'done'; contentType: 'video/mp4' | 'video/webm' }
  | { type: 'failed'; message: string };

function startWorker(): Worker {
  return new Worker(new URL('./video-normalize.worker.ts', import.meta.url), {
    type: 'module',
  });
}

/** What a picked video is, read in the worker. */
export function inspectVideo(url: string): Promise<VideoReport> {
  const worker = startWorker();
  return new Promise<VideoReport>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<NormalizeReply>) => {
      const reply = event.data;
      if (reply.type === 'report') resolve(reply.report);
      else if (reply.type === 'failed') reject(new Error(reply.message));
    };
    worker.onerror = () => reject(new Error('The video could not be read.'));
    worker.postMessage({ type: 'inspect', url } satisfies NormalizeRequest);
  }).finally(() => worker.terminate());
}

/**
 * Writes the normalised version of a picked video and returns it as a new
 * picked video, ready to upload. `onProgress` gets 0 to 1.
 */
export async function normalizeVideo(
  picked: PickedVideo,
  report: VideoReport,
  onProgress: (progress: number) => void,
): Promise<PickedVideo> {
  const worker = startWorker();
  let outputToken: string | null = null;
  try {
    return await new Promise<PickedVideo>((resolve, reject) => {
      worker.onerror = () =>
        reject(new Error('The video could not be converted.'));
      worker.onmessage = async (event: MessageEvent<NormalizeReply>) => {
        const reply = event.data;
        try {
          switch (reply.type) {
            case 'chunk':
              outputToken ??= await window.pakita.media.beginNormalized();
              await window.pakita.media.writeNormalized(
                outputToken,
                reply.position,
                reply.data,
              );
              worker.postMessage({
                type: 'written',
                id: reply.id,
              } satisfies NormalizeRequest);
              return;
            case 'progress':
              onProgress(reply.progress);
              return;
            case 'done': {
              if (!outputToken)
                throw new Error('The conversion wrote nothing.');
              const finished = await window.pakita.media.finishNormalized(
                outputToken,
                picked.fileName,
                reply.contentType,
              );
              outputToken = null;
              resolve(finished);
              return;
            }
            case 'failed':
              reject(new Error(reply.message));
              return;
            case 'report':
              return;
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      worker.postMessage({
        type: 'normalize',
        url: picked.url,
        report,
      } satisfies NormalizeRequest);
    });
  } finally {
    worker.terminate();
    if (outputToken) void window.pakita.media.discardNormalized(outputToken);
  }
}
