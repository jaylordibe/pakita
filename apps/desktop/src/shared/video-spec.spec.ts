import { describe, expect, it } from 'vitest';

import { assessVideo, fittedSize } from './video-spec';

describe('fittedSize', () => {
  it('scales a larger video into 1080p, keeping its shape', () => {
    expect(fittedSize(2560, 1440)).toEqual({ width: 1920, height: 1080 });
    expect(fittedSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(fittedSize(4096, 2160)).toEqual({ width: 1920, height: 1012 });
    expect(fittedSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(fittedSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
  });

  it('never enlarges, and keeps sizes even', () => {
    expect(fittedSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(fittedSize(1279, 719)).toEqual({ width: 1280, height: 720 });
  });
});

describe('assessVideo', () => {
  const facts = {
    container: 'video/mp4; codecs="avc1.640028"',
    codec: 'avc',
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 8_000_000,
  };

  it('passes a 1080p H.264 MP4 or VP9 WebM as it is', () => {
    expect(assessVideo(facts)).toEqual({
      transcodeReasons: [],
      needsRewrap: false,
    });
    expect(
      assessVideo({
        ...facts,
        container: 'video/webm; codecs="vp09.00.10.08"',
        codec: 'vp9',
      }),
    ).toEqual({ transcodeReasons: [], needsRewrap: false });
  });

  it('copies a compliant .mov into an MP4', () => {
    expect(assessVideo({ ...facts, container: 'video/quicktime' })).toEqual({
      transcodeReasons: [],
      needsRewrap: true,
    });
  });

  it('re-encodes what is too large, too fast, too heavy or not H.264/VP9', () => {
    const reasonsFor = (overrides: Partial<typeof facts>) =>
      assessVideo({ ...facts, ...overrides }).transcodeReasons;
    expect(reasonsFor({ width: 2560, height: 1440 })).toEqual([
      '2560 × 1440 is larger than 1080p',
    ]);
    expect(reasonsFor({ frameRate: 120 })).toEqual(['120 fps is above 60']);
    expect(reasonsFor({ frameRate: 60.2 })).toEqual([]);
    expect(reasonsFor({ bitrate: 40_000_000 })).toHaveLength(1);
    expect(reasonsFor({ codec: 'hevc' })).toEqual([
      'hevc does not play on every laptop',
    ]);
    expect(
      assessVideo({ ...facts, codec: 'hevc', container: 'video/quicktime' })
        .needsRewrap,
    ).toBe(false);
  });
});
