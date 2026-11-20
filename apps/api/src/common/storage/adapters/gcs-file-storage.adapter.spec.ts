import type { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GcsFileStorageAdapter } from './gcs-file-storage.adapter';

// The real adapter and the real V4 signer. A throwaway service-account key,
// generated here and found through Application Default Credentials, makes
// signing local: no Google account, no network.
describe('GcsFileStorageAdapter signed uploads', () => {
  let directory: string;
  let previousCredentials: string | undefined;
  let adapter: GcsFileStorageAdapter;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'gcs-signer-'));
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyFile = join(directory, 'service-account.json');
    writeFileSync(
      keyFile,
      JSON.stringify({
        type: 'service_account',
        project_id: 'fixture-project',
        client_email: 'signer@fixture-project.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }),
    );
    previousCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
    const configuration: Record<string, unknown> = {
      'storage.gcs.bucket': 'fixture-bucket',
      'storage.gcs.projectId': 'fixture-project',
      'storage.requestTimeoutMs': 15_000,
    };
    adapter = new GcsFileStorageAdapter({
      get: (path: string) => configuration[path],
      getOrThrow: (path: string) => configuration[path],
    } as unknown as ConfigService);
  });

  afterAll(() => {
    if (previousCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = previousCredentials;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it('signs a PUT of exactly the declared size, type and headers', async () => {
    const upload = await adapter.createSignedUploadUrl(
      'files/background-videos/loop.mp4',
      {
        sizeBytes: 1234,
        contentType: 'video/mp4',
        sha256Base64: 'unused-by-gcs',
        contentDisposition: 'attachment; filename="loop.mp4"',
        cacheControl: 'private, max-age=3600',
      },
      3600,
    );

    const url = new URL(upload.url);
    expect(url.host).toBe('storage.googleapis.com');
    expect(url.pathname).toBe(
      '/fixture-bucket/files/background-videos/loop.mp4',
    );
    expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
    expect(url.searchParams.get('X-Goog-Expires')).toBe('3600');
    // Every header the client sends is signed, so storage refuses a request
    // that changes one — the size range above all.
    expect(url.searchParams.get('X-Goog-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining([
        'cache-control',
        'content-disposition',
        'content-type',
        'host',
        'x-goog-content-length-range',
      ]),
    );
    expect(upload.headers).toEqual({
      'content-type': 'video/mp4',
      'content-disposition': 'attachment; filename="loop.mp4"',
      'cache-control': 'private, max-age=3600',
      'x-goog-content-length-range': '1234,1234',
    });
  });
});
