import { describe, expect, it } from 'vitest';

import { findUpdate, isReleasePage } from './update-check';

const answering = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status });

const release = (tag: string) => ({
  tag_name: tag,
  html_url: `https://github.com/jaylordibe/pakita/releases/tag/${tag}`,
});

describe('findUpdate', () => {
  it('reports a newer release and its page', async () => {
    await expect(
      findUpdate('1.2.0', answering(200, release('v1.10.0'))),
    ).resolves.toEqual({
      version: '1.10.0',
      url: 'https://github.com/jaylordibe/pakita/releases/tag/v1.10.0',
    });
  });

  it('stays quiet when current, offline, refused or answered oddly', async () => {
    await expect(
      findUpdate('1.2.0', answering(200, release('v1.2.0'))),
    ).resolves.toBeNull();
    await expect(findUpdate('1.2.0', answering(403, {}))).resolves.toBeNull();
    await expect(
      findUpdate('1.2.0', async () => {
        throw new Error('offline');
      }),
    ).resolves.toBeNull();
    await expect(
      findUpdate(
        '1.2.0',
        answering(200, {
          tag_name: 'v9.9.9; rm -rf /',
        }),
      ),
    ).resolves.toBeNull();
  });
});

describe('isReleasePage', () => {
  it('accepts only this project’s release pages', () => {
    expect(
      isReleasePage('https://github.com/jaylordibe/pakita/releases/tag/v1.0.0'),
    ).toBe(true);
    expect(
      isReleasePage('https://github.com/someone/else/releases/tag/v1.0.0'),
    ).toBe(false);
    expect(isReleasePage('javascript:alert(1)')).toBe(false);
    expect(
      isReleasePage('https://github.com/jaylordibe/pakita/releases/../../x/y'),
    ).toBe(false);
  });
});
