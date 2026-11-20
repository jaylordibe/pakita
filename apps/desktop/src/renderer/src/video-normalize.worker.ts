import {
  ALL_FORMATS,
  Conversion,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type StreamTargetChunk,
  UrlSource,
  WebMOutputFormat,
} from 'mediabunny';

import {
  assessVideo,
  fittedSize,
  MAX_FRAME_RATE,
} from '../../shared/video-spec';
import type {
  NormalizeReply,
  NormalizeRequest,
  VideoReport,
} from './video-normalize';

// Reads a picked video and, when it is outside the video spec, writes the
// version every laptop plays: H.264 in MP4 (VP9 in WebM where this laptop
// cannot encode H.264), at most 1080p and 60 fps, without audio. In a worker,
// so the operator window stays responsive; WebCodecs uses the laptop's
// hardware encoder where it has one.

const post = (reply: NormalizeReply, transfer: Transferable[] = []) =>
  self.postMessage(reply, { transfer });

let conversion: Conversion | null = null;
let input: Input | null = null;
const pendingWrites = new Map<number, () => void>();
let nextWriteId = 0;

async function inspect(url: string): Promise<VideoReport> {
  const source = new Input({
    source: new UrlSource(url),
    formats: ALL_FORMATS,
  });
  try {
    const container = await source.getMimeType();
    const track = await source.getPrimaryVideoTrack();
    if (!track) throw new Error('This file has no video in it.');
    const [isDecodable, stats, duration] = await Promise.all([
      track.canDecode(),
      track.computePacketStats(120),
      source.computeDuration(),
    ]);
    const width = track.displayWidth;
    const height = track.displayHeight;
    const assessment = assessVideo({
      container,
      codec: track.codec,
      width,
      height,
      frameRate: stats.averagePacketRate,
      bitrate: stats.averageBitrate,
    });
    return {
      container,
      codec: track.codec,
      width,
      height,
      durationMs: Math.round(duration * 1000),
      frameRate: stats.averagePacketRate,
      isDecodable,
      ...assessment,
    };
  } finally {
    source.dispose();
  }
}

async function normalize(url: string, report: VideoReport): Promise<void> {
  input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  const isTranscode = report.transcodeReasons.length > 0;
  const size = fittedSize(report.width, report.height);
  const codec = isTranscode
    ? await getFirstEncodableVideoCodec(['avc', 'vp9'], size)
    : report.codec === 'vp9'
      ? 'vp9'
      : 'avc';
  if (!codec) {
    throw new Error('This laptop cannot encode video. Upload a 1080p MP4.');
  }
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) =>
      new Promise<void>((resolve) => {
        const id = nextWriteId++;
        pendingWrites.set(id, resolve);
        post(
          { type: 'chunk', id, position: chunk.position, data: chunk.data },
          [chunk.data.buffer],
        );
      }),
  });
  const output = new Output({
    format: codec === 'avc' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new StreamTarget(writable, { chunked: true }),
  });
  conversion = await Conversion.init({
    input,
    output,
    video: isTranscode
      ? {
          ...size,
          fit: 'contain',
          codec,
          quality: QUALITY_HIGH,
          ...(report.frameRate > MAX_FRAME_RATE + 0.5 && {
            frameRate: MAX_FRAME_RATE,
          }),
          forceTranscode: true,
        }
      : {},
    // A background plays muted; its sound would only add to the download.
    audio: { discard: true },
  });
  if (!conversion.isValid) {
    const video = conversion.discardedTracks.find(
      (discarded) => discarded.track.type === 'video',
    );
    throw new Error(
      video?.reason === 'undecodable_source_codec'
        ? 'This laptop cannot read this video’s format (ProRes, for example). Export it as an MP4 (H.264).'
        : 'This video cannot be converted. Export it as an MP4 (H.264).',
    );
  }
  conversion.onProgress = (progress) => post({ type: 'progress', progress });
  await conversion.execute();
  post({
    type: 'done',
    contentType: codec === 'avc' ? 'video/mp4' : 'video/webm',
  });
}

self.onmessage = async (event: MessageEvent<NormalizeRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'inspect':
        post({ type: 'report', report: await inspect(request.url) });
        return;
      case 'normalize':
        await normalize(request.url, request.report);
        return;
      case 'written':
        pendingWrites.get(request.id)?.();
        pendingWrites.delete(request.id);
        return;
      case 'cancel':
        await conversion?.cancel();
        return;
    }
  } catch (error) {
    post({
      type: 'failed',
      message:
        error instanceof Error ? error.message : 'The video could not be read.',
    });
  } finally {
    if (request.type === 'normalize') {
      input?.dispose();
      input = null;
      conversion = null;
    }
  }
};
