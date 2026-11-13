import { describe, expect, it } from 'vitest';

import { parseServerAddress } from './server-address';

describe('parseServerAddress', () => {
  it.each([
    ['pakita.example.org', 'https://pakita.example.org'],
    [
      'https://pakita.example.org/some/path?x=1#y',
      'https://pakita.example.org',
    ],
    ['  https://pakita.example.org:8443  ', 'https://pakita.example.org:8443'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ])('accepts %s as %s', (input, origin) => {
    expect(parseServerAddress(input)).toEqual({ isValid: true, origin });
  });

  it.each([
    '',
    'http://pakita.example.org',
    'ftp://pakita.example.org',
    'https://user:secret@pakita.example.org',
    'https://',
    'javascript:alert(1)',
  ])('refuses %j', (input) => {
    expect(parseServerAddress(input).isValid).toBe(false);
  });
});
