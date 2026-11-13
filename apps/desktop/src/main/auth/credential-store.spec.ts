import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
};

describe('CredentialStore', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pakita-credentials-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
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
