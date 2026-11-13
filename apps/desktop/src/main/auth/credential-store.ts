import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { readJsonFile, writeJsonFile } from '../storage/json-file';

/** The subset of Electron's `safeStorage` the store uses. */
export interface SecretEncryption {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
  /** Linux only: which keyring backs the encryption. */
  getSelectedStorageBackend?(): string;
}

const accountSchema = z.object({
  origin: z.string(),
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
});
export type StoredAccount = z.infer<typeof accountSchema>;

/**
 * Remembers who is signed in on this laptop, so its synchronised content can
 * be presented at the next start without the network.
 *
 * - `account.json`: who, on which server — not secret.
 * - `credentials.bin`: the refresh token, encrypted by the operating
 *   system's keychain (Electron `safeStorage`). The access token is never
 *   stored; it lives in memory only.
 *
 * Where the system offers no real keychain (Linux's `basic_text` fallback
 * encrypts with a hard-coded key), or the keychain refuses (the operator
 * denied macOS's prompt), the refresh token is NOT stored: the operator signs
 * in again after a restart, and offline presenting still works.
 */
export class CredentialStore {
  private readonly accountPath: string;
  private readonly credentialsPath: string;

  constructor(
    userDataDirectory: string,
    private readonly encryption: SecretEncryption,
  ) {
    this.accountPath = join(userDataDirectory, 'account.json');
    this.credentialsPath = join(userDataDirectory, 'credentials.bin');
  }

  async canStoreSecrets(): Promise<boolean> {
    if (!(await this.encryption.isAsyncEncryptionAvailable())) {
      return false;
    }
    return this.encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }

  loadAccount(): StoredAccount | null {
    return readJsonFile(this.accountPath, accountSchema.nullable(), null);
  }

  async loadRefreshToken(): Promise<string | null> {
    // No stored token: do not touch the keychain at all (on macOS its first
    // use by an app can show a permission prompt).
    if (!existsSync(this.credentialsPath) || !(await this.canStoreSecrets())) {
      return null;
    }
    try {
      const decrypted = await this.encryption.decryptStringAsync(
        readFileSync(this.credentialsPath),
      );
      // The keychain rotated its key: store the secret under the new one.
      if (decrypted.shouldReEncrypt) {
        await this.saveRefreshToken(decrypted.result);
      }
      return decrypted.result;
    } catch {
      // Unreadable (another user's keychain, a damaged file): sign in again.
      return null;
    }
  }

  async save(account: StoredAccount, refreshToken: string): Promise<void> {
    writeJsonFile(this.accountPath, account);
    await this.saveRefreshToken(refreshToken);
  }

  async saveRefreshToken(refreshToken: string): Promise<void> {
    if (!(await this.canStoreSecrets())) {
      return;
    }
    let encrypted: Buffer;
    try {
      encrypted = await this.encryption.encryptStringAsync(refreshToken);
    } catch {
      // The keychain refused (on macOS, the operator denied its prompt):
      // treat it as no keychain. The sign-in or refresh still succeeds; the
      // token is not kept, and the superseded one on disk is removed so it
      // is never tried again.
      this.clearRefreshToken();
      return;
    }
    writeFileSync(this.credentialsPath, encrypted, { mode: 0o600 });
  }

  /** Forgets the refresh token but keeps the account (its offline content). */
  clearRefreshToken(): void {
    rmSync(this.credentialsPath, { force: true });
  }

  clear(): void {
    this.clearRefreshToken();
    rmSync(this.accountPath, { force: true });
  }
}
