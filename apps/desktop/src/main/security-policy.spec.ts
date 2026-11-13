import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APP_ORIGIN,
  createSecureWebPreferences,
  createTrustedOrigins,
  isTrustedUrl,
  resolveRendererFile,
} from './security-policy';

describe('createSecureWebPreferences', () => {
  const preferences = createSecureWebPreferences('/app/preload.js');

  it.each([
    ['contextIsolation', true],
    ['sandbox', true],
    ['nodeIntegration', false],
    ['nodeIntegrationInSubFrames', false],
    ['nodeIntegrationInWorker', false],
    ['webSecurity', true],
    ['allowRunningInsecureContent', false],
    ['webviewTag', false],
  ] as const)('sets %s to %s', (key, expected) => {
    expect(preferences[key]).toBe(expected);
  });

  it('uses the given preload', () => {
    expect(preferences.preload).toBe('/app/preload.js');
  });
});

describe('isTrustedUrl', () => {
  const packaged = createTrustedOrigins();
  const development = createTrustedOrigins('http://localhost:5173');

  it('trusts the app origin', () => {
    expect(isTrustedUrl(`${APP_ORIGIN}/index.html`, packaged)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'http://localhost:5173/',
    'app://other/index.html',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s in a packaged build', (url) => {
    expect(isTrustedUrl(url, packaged)).toBe(false);
  });

  it('trusts the development server only when it is configured', () => {
    expect(isTrustedUrl('http://localhost:5173/', development)).toBe(true);
    expect(isTrustedUrl('http://localhost:5174/', development)).toBe(false);
  });
});

describe('resolveRendererFile', () => {
  const root = resolve('/opt/pakita/renderer');

  it('serves index.html for the root path', () => {
    expect(resolveRendererFile(root, '/')).toBe(join(root, 'index.html'));
  });

  it('serves a file inside the renderer folder', () => {
    expect(resolveRendererFile(root, '/assets/index.js')).toBe(
      join(root, 'assets', 'index.js'),
    );
  });

  it.each([
    '/../main/index.js',
    '/assets/../../main/index.js',
    '/%2e%2e/main/index.js',
    '/%2E%2E%2Fmain%2Findex.js',
    '/..%5cmain%5cindex.js',
    '/%00index.html',
    '/%E0%A4%A',
  ])('refuses %s', (pathname) => {
    expect(resolveRendererFile(root, pathname)).toBeNull();
  });
});
