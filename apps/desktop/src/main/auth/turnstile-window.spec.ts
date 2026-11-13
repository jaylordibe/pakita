import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
vi.mock('../security', () => ({}));

const { readTurnstileToken } = await import('./turnstile-window');

const origin = 'https://pakita.example.org';

describe('readTurnstileToken', () => {
  it('reads the token from the done page’s fragment', () => {
    expect(
      readTurnstileToken(
        `${origin}/api/public/desktop-turnstile/done#token=abc.DEF-123`,
        origin,
      ),
    ).toBe('abc.DEF-123');
  });

  it.each([
    'https://evil.example.org/api/public/desktop-turnstile/done#token=x',
    `${origin}/api/public/desktop-turnstile#token=x`,
    `${origin}/api/public/desktop-turnstile/done`,
    `${origin}/api/public/desktop-turnstile/done#token=`,
    `${origin}/api/public/desktop-turnstile/done#token=${'x'.repeat(2049)}`,
    'not a url',
  ])('ignores %s', (url) => {
    expect(readTurnstileToken(url, origin)).toBeNull();
  });
});
