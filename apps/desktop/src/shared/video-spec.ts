// What a background video must be for every laptop of a church to play it
// smoothly, stated once. A picked video outside it is normalised on the
// uploading laptop before it is uploaded (renderer/video-normalize).
//
// The server's own ceiling (1920 × 1080, `CreateMediaDto`) is the same box;
// it is the API's to enforce, and this file's to never exceed.

/** 1080p: the long side and the short side, in pixels. */
export const MAX_LONG_SIDE = 1920;
export const MAX_SHORT_SIDE = 1080;
export const MAX_FRAME_RATE = 60;
/** Bits per second; far above what a good 1080p loop needs. */
export const MAX_BITRATE = 16_000_000;
/** The largest file uploaded (the server's `background_video` limit). */
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

/** Containers and codecs every laptop plays, as Mediabunny names them. */
export const PLAYABLE_CONTAINERS = ['video/mp4', 'video/webm'] as const;
export const PLAYABLE_CODECS = ['avc', 'vp9'] as const;

/** The size a video is scaled to, to fit the 1080p box (even, as encoders need). */
export function fittedSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const isLandscape = width >= height;
  const scale = Math.min(
    1,
    MAX_LONG_SIDE / (isLandscape ? width : height),
    MAX_SHORT_SIDE / (isLandscape ? height : width),
  );
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

/** What a picked video is, as read from its file. */
export interface VideoFacts {
  /** A MIME type, perhaps with parameters (`video/webm; codecs="vp09…"`). */
  readonly container: string;
  readonly codec: string | null;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly bitrate: number;
}

/**
 * What must happen to a video before upload: the reasons it must be
 * re-encoded (empty when within the spec), and whether, within the spec, it
 * only needs copying into an MP4 (a .mov).
 */
export function assessVideo(facts: VideoFacts): {
  transcodeReasons: string[];
  needsRewrap: boolean;
} {
  const { width, height } = facts;
  const reasons: string[] = [];
  if (
    Math.max(width, height) > MAX_LONG_SIDE ||
    Math.min(width, height) > MAX_SHORT_SIDE
  ) {
    reasons.push(`${width} × ${height} is larger than 1080p`);
  }
  if (facts.frameRate > MAX_FRAME_RATE + 0.5) {
    reasons.push(`${Math.round(facts.frameRate)} fps is above 60`);
  }
  if (facts.bitrate > MAX_BITRATE) {
    reasons.push('its bitrate is higher than needed');
  }
  if (!(PLAYABLE_CODECS as readonly string[]).includes(facts.codec ?? '')) {
    reasons.push(`${facts.codec ?? 'its codec'} does not play on every laptop`);
  }
  const container = facts.container.split(';')[0]!.trim().toLowerCase();
  return {
    transcodeReasons: reasons,
    needsRewrap:
      reasons.length === 0 &&
      !(PLAYABLE_CONTAINERS as readonly string[]).includes(container),
  };
}
