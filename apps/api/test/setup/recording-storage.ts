import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../src/common/redis/redis.service';
import { SIGNED_READ_URL_CACHE_PREFIX } from '../../src/common/storage/signed-read-url-cache.service';
import type {
  FileStorageAdapter,
  ObjectContent,
  SignedUpload,
  SignedUploadRequest,
  StoredObject,
} from '../../src/common/storage/adapters/file-storage-adapter.interface';

// An in-memory storage adapter for app e2e specs, swapped in for the stub with
// `overrideProvider(FILE_STORAGE_ADAPTER)`.
//
// The stub drops every byte, which leaves nothing to assert about what was
// stored; this keeps the objects, so a spec can check the bytes and headers
// the application actually wrote and whether an object is gone. Failures are
// switched on per spec to exercise the retry paths.
export class RecordingStorageAdapter implements FileStorageAdapter {
  readonly providerName = 'recording';
  readonly isPersistent = true;
  readonly objects = new Map<string, ObjectContent>();
  readonly deleteAttempts: string[] = [];
  // Direct uploads signed so far, by key: what a client was allowed to write.
  readonly signedUploads = new Map<string, SignedUploadRequest>();
  isPutFailing = false;
  isDeleteFailing = false;
  isSignFailing = false;

  put(storageKey: string, content: ObjectContent): Promise<void> {
    if (this.isPutFailing) {
      return Promise.reject(new Error('storage put unavailable (test)'));
    }
    this.objects.set(storageKey, content);
    return Promise.resolve();
  }

  delete(storageKey: string): Promise<void> {
    this.deleteAttempts.push(storageKey);
    if (this.isDeleteFailing) {
      return Promise.reject(new Error('storage delete unavailable (test)'));
    }
    this.objects.delete(storageKey);
    return Promise.resolve();
  }

  createSignedReadUrl(storageKey: string, ttlSeconds: number): Promise<string> {
    if (this.isSignFailing) {
      return Promise.reject(new Error('storage signing unavailable (test)'));
    }
    return Promise.resolve(
      `https://storage.test/${storageKey}?expires-in=${ttlSeconds}&signature=test`,
    );
  }

  createSignedUploadUrl(
    storageKey: string,
    request: SignedUploadRequest,
    ttlSeconds: number,
  ): Promise<SignedUpload> {
    if (this.isSignFailing) {
      return Promise.reject(new Error('storage signing unavailable (test)'));
    }
    this.signedUploads.set(storageKey, request);
    return Promise.resolve({
      url: `https://storage.test/${storageKey}?expires-in=${ttlSeconds}&signature=upload`,
      headers: {
        'content-type': request.contentType,
        'x-amz-checksum-sha256': request.sha256Base64,
      },
    });
  }

  head(storageKey: string): Promise<StoredObject | null> {
    const stored = this.objects.get(storageKey);
    return Promise.resolve(
      stored ? { sizeBytes: stored.body.byteLength } : null,
    );
  }

  readStart(storageKey: string, length: number): Promise<Buffer> {
    const stored = this.objects.get(storageKey);
    return Promise.resolve(
      stored ? stored.body.subarray(0, length) : Buffer.alloc(0),
    );
  }

  /**
   * A client's PUT to a signed upload URL, checked as S3 checks it: the body
   * must match the signed size and SHA-256, or nothing is stored. Set
   * `isUnchecked` to store whatever arrives, as a backend that signs no size
   * or hash (Azure) would.
   */
  receiveUpload(
    storageKey: string,
    body: Buffer,
    { isUnchecked = false }: { isUnchecked?: boolean } = {},
  ): boolean {
    const signed = this.signedUploads.get(storageKey);
    if (!signed) return false;
    const sha256Base64 = createHash('sha256').update(body).digest('base64');
    if (
      !isUnchecked &&
      (body.byteLength !== signed.sizeBytes ||
        sha256Base64 !== signed.sha256Base64)
    ) {
      return false;
    }
    this.objects.set(storageKey, {
      body,
      contentType: signed.contentType,
      contentDisposition: signed.contentDisposition,
      cacheControl: signed.cacheControl,
    });
    return true;
  }

  reset(): void {
    this.signedUploads.clear();
    this.objects.clear();
    this.deleteAttempts.length = 0;
    this.isPutFailing = false;
    this.isDeleteFailing = false;
    this.isSignFailing = false;
  }
}

// A storage outage as a request first meets it: signing fails, and no URL
// signed before the outage is still cached (`SignedReadUrlCacheService`), so
// every picture in the next response has to be signed — and fails.
export async function startSignOutage(
  app: INestApplication,
  storage: RecordingStorageAdapter,
): Promise<void> {
  storage.isSignFailing = true;
  const redis = app.get(RedisService).client;
  const cached = await redis.keys(`${SIGNED_READ_URL_CACHE_PREFIX}*`);
  if (cached.length > 0) await redis.del(...cached);
}
