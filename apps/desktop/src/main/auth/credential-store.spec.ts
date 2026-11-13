import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CredentialStore, type SecretEncryption } from './credential-store';

// Reversible stand-in for the OS keychain: what matters is that the file on
// disk never holds the token in clear text.
const keychain = (backend = 'keychain'): SecretEncryption => ({
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plainText) =>
    Buffer.from(Buffer.from(plainText, 'utf8').map((byte) => byte ^ 0x5a)),
  decryptStringAsync: async (encrypted) => ({
    result: Buffer.from(encrypted.map((byte) => byte ^ 0x5a)).toString('utf8'),
    shouldReEncrypt: false,
  }),
  getSelectedStorageBackend: () => backend,
});

const account = {
  origin: 'https://pakita.example.org',
  userId: 'user-1',
  email: 'operator@example.org',
  displayName: 'Operator',
  isPasswordChangeRequired: false,
};

describe('CredentialStore', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pakita-credentials-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads an account saved before the password-change flag existed', () => {
    writeFileSync(
      join(directory, 'account.json'),
      JSON.stringify({
        origin: account.origin,
        userId: account.userId,
        email: account.email,
        displayName: account.displayName,
      }),
    );
    expect(new CredentialStore(directory, keychain()).loadAccount()).toEqual({
      ...account,
      isPasswordChangeRequired: false,
    });
  });

  it('keeps device tokens per server and account, across sign-out', () => {
    const store = new CredentialStore(directory, keychain());
    store.saveDeviceToken('https://a.example', 'user-1', 'token-1');
    store.saveDeviceToken('https://a.example', 'user-2', 'token-2');
    store.saveDeviceToken('https://a.example', 'user-1', 'token-1b');
    store.saveDeviceToken('https://b.example', 'user-1', 'token-b');
    store.clear();

    const reopened = new CredentialStore(directory, keychain());
    expect(reopened.loadDeviceTokens('https://a.example')).toEqual([
      'token-2',
      'token-1b',
    ]);
    expect(reopened.loadDeviceTokens('https://b.example')).toEqual(['token-b']);
    expect(reopened.loadDeviceTokens('https://c.example')).toEqual([]);
  });

  it('keeps at most ten device tokens per server, dropping the oldest', () => {
    const store = new CredentialStore(directory, keychain());
    for (let index = 0; index < 12; index += 1) {
      store.saveDeviceToken('https://a.example', `user-${index}`, `t-${index}`);
    }
    const tokens = store.loadDeviceTokens('https://a.example');
    expect(tokens).toHaveLength(10);
    expect(tokens[0]).toBe('t-2');
  });

  it('keeps the refresh token encrypted and reads it back', async () => {
    const store = new CredentialStore(directory, keychain());
    await store.save(account, 'refresh-secret');

    expect(
      readFileSync(join(directory, 'credentials.bin')).toString('utf8'),
    ).not.toContain('refresh-secret');
    const reopened = new CredentialStore(directory, keychain());
    expect(reopened.loadAccount()).toEqual(account);
    await expect(reopened.loadRefreshToken()).resolves.toBe('refresh-secret');
  });

  it('never stores the token behind Linux’s plaintext fallback', async () => {
    const store = new CredentialStore(directory, keychain('basic_text'));
    await store.save(account, 'refresh-secret');

    await expect(store.canStoreSecrets()).resolves.toBe(false);
    expect(store.loadAccount()).toEqual(account);
    await expect(store.loadRefreshToken()).resolves.toBeNull();
  });

  it('forgets the token but keeps the account on clearRefreshToken', async () => {
    const store = new CredentialStore(directory, keychain());
    await store.save(account, 'refresh-secret');
    store.clearRefreshToken();

    await expect(store.loadRefreshToken()).resolves.toBeNull();
    expect(store.loadAccount()).toEqual(account);
    store.clear();
    expect(store.loadAccount()).toBeNull();
  });

  // macOS: the operator denies the keychain prompt, and Chromium's lookup
  // fails with userCanceledErr. Signing in must still succeed; the token is
  // simply not kept, as where there is no keychain at all.
  it('lets the sign-in through when the keychain refuses to encrypt', async () => {
    const store = new CredentialStore(directory, keychain());
    await store.save(account, 'old-secret');
    const refusing = new CredentialStore(directory, {
      ...keychain(),
      encryptStringAsync: async () => {
        throw new Error(
          'Error while encrypting the text provided to safeStorage.encryptStringAsync.',
        );
      },
    });

    await expect(refusing.save(account, 'new-secret')).resolves.toBeUndefined();
    expect(refusing.loadAccount()).toEqual(account);
    // The previous token is superseded by one that could not be kept: no
    // stale token is left to be tried at the next start.
    expect(existsSync(join(directory, 'credentials.bin'))).toBe(false);
    await expect(refusing.loadRefreshToken()).resolves.toBeNull();
  });

  it('re-encrypts a secret when the keychain rotated its key', async () => {
    const encryption = keychain();
    const store = new CredentialStore(directory, encryption);
    await store.save(account, 'refresh-secret');
    let encryptions = 0;
    const rotating: SecretEncryption = {
      ...encryption,
      encryptStringAsync: async (plainText) => {
        encryptions += 1;
        return encryption.encryptStringAsync(plainText);
      },
      decryptStringAsync: async (encrypted) => ({
        ...(await encryption.decryptStringAsync(encrypted)),
        shouldReEncrypt: true,
      }),
    };
    await expect(
      new CredentialStore(directory, rotating).loadRefreshToken(),
    ).resolves.toBe('refresh-secret');
    expect(encryptions).toBe(1);
  });
});
