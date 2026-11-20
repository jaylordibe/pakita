import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from '@azure/storage-blob';
import {
  FileStorageAdapter,
  ObjectContent,
  SignedUpload,
  SignedUploadRequest,
  StoredObject,
} from './file-storage-adapter.interface';

// Azure Blob Storage. Selected with STORAGE_PROVIDER=azure.
//
// This file is the ONLY place in the application that imports an Azure SDK, and
// it is loaded only when this provider is selected.
//
// CREDENTIALS are `DefaultAzureCredential`: a managed identity on Container
// Apps / App Service / AKS workload identity, an Azure CLI login locally. There
// is deliberately no configuration key for an account key or a connection
// string — both are long-lived shared secrets that grant full control of the
// storage account, and both are avoidable on every supported host.
//
// SIGNED URLS are USER DELEGATION SAS tokens, signed with a key obtained from
// Azure AD rather than the account key. That is what keeps this keyless: the
// SAS inherits the identity's own permissions and cannot outlive the delegation
// key. The identity needs `Storage Blob Data Contributor` on the container.
// Tolerance for clock drift between this process and the storage service when
// stamping a SAS start time. Five minutes is the conventional allowance and
// costs nothing: the grant's EXPIRY is still measured from now.
const CLOCK_SKEW_ALLOWANCE_MILLISECONDS = 5 * 60 * 1000;

// How long one user delegation key is requested for. Every SAS it signs must
// expire before it does, so it is renewed once it would not outlive the URL
// being signed (URLs live at most an hour, `MAXIMUM_SIGNED_URL_TTL_SECONDS`).
const DELEGATION_KEY_LIFETIME_MILLISECONDS = 2 * 60 * 60 * 1000;

interface CachedDelegationKey {
  expiresOn: Date;
  key: Promise<UserDelegationKey>;
}

@Injectable()
export class AzureFileStorageAdapter implements FileStorageAdapter {
  readonly providerName = 'azure';
  readonly isPersistent = true;

  private readonly blobServiceClient: BlobServiceClient;
  private cachedDelegationKey: CachedDelegationKey | null = null;
  private readonly accountName: string;
  private readonly containerName: string;

  constructor(configService: ConfigService) {
    this.accountName = configService.getOrThrow<string>(
      'storage.azure.accountName',
    );
    this.containerName = configService.getOrThrow<string>(
      'storage.azure.container',
    );

    this.blobServiceClient = new BlobServiceClient(
      `https://${this.accountName}.blob.core.windows.net`,
      new DefaultAzureCredential(),
      {
        // Bounds each attempt. Unset, the SDK waits indefinitely on a stalled
        // connection and the caller's database connection stays checked out.
        retryOptions: {
          tryTimeoutInMs: configService.getOrThrow<number>(
            'storage.requestTimeoutMs',
          ),
        },
      },
    );
  }

  private blobClient(storageKey: string) {
    return this.blobServiceClient
      .getContainerClient(this.containerName)
      .getBlockBlobClient(storageKey);
  }

  async put(storageKey: string, content: ObjectContent): Promise<void> {
    await this.blobClient(storageKey).uploadData(content.body, {
      blobHTTPHeaders: {
        blobContentType: content.contentType,
        blobContentDisposition: content.contentDisposition,
        // Caching, not permission — the container's own access level decides
        // readability.
        blobCacheControl: content.cacheControl,
      },
    });
  }

  // `deleteIfExists` makes "already gone" a success; anything else propagates
  // for the caller to retry.
  async delete(storageKey: string): Promise<void> {
    await this.blobClient(storageKey).deleteIfExists();
  }

  async createSignedReadUrl(
    storageKey: string,
    ttlSeconds: number,
  ): Promise<string> {
    // Back-dated, deliberately. A SAS whose `st` is even slightly ahead of the
    // storage service's clock is rejected outright ("Signature not valid in the
    // specified time frame") — and at the 30s TTL floor a few seconds of skew
    // can miss the window entirely. Expiry is still measured from NOW, so the
    // grant is never longer than the caller asked for.
    const startsOn = new Date(Date.now() - CLOCK_SKEW_ALLOWANCE_MILLISECONDS);
    const expiresOn = new Date(Date.now() + ttlSeconds * 1000);

    const userDelegationKey = await this.delegationKeyValidUntil(expiresOn);

    const sasQueryParameters = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: storageKey,
        // Read only. Never `racwd` — a signed URL handed to a client must not
        // be able to overwrite or delete the object it points at.
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
      },
      userDelegationKey,
      this.accountName,
    );

    return `${this.blobClient(storageKey).url}?${sasQueryParameters.toString()}`;
  }

  // A user delegation key is an Azure AD round trip, and every user response
  // that shows a picture signs a URL — a list page would otherwise make one
  // round trip per row. One key is shared until it would not outlive the URL
  // being signed; concurrent callers share the in-flight fetch, and a failed
  // fetch is forgotten so the next call retries. The key is held in memory for
  // at most DELEGATION_KEY_LIFETIME_MILLISECONDS.
  // A SAS grants create and write on one blob; Azure signs neither its size
  // nor a SHA-256, so `complete` checks the size and every client that
  // downloads the file checks the hash. The SAS fixes the stored headers.
  async createSignedUploadUrl(
    storageKey: string,
    request: SignedUploadRequest,
    ttlSeconds: number,
  ): Promise<SignedUpload> {
    const startsOn = new Date(Date.now() - CLOCK_SKEW_ALLOWANCE_MILLISECONDS);
    const expiresOn = new Date(Date.now() + ttlSeconds * 1000);
    const userDelegationKey = await this.delegationKeyValidUntil(expiresOn);
    const sasQueryParameters = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: storageKey,
        permissions: BlobSASPermissions.parse('cw'),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
        contentType: request.contentType,
        contentDisposition: request.contentDisposition,
        cacheControl: request.cacheControl,
      },
      userDelegationKey,
      this.accountName,
    );
    return {
      url: `${this.blobClient(storageKey).url}?${sasQueryParameters.toString()}`,
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-blob-content-type': request.contentType,
        'x-ms-blob-content-disposition': request.contentDisposition,
        'x-ms-blob-cache-control': request.cacheControl,
      },
    };
  }

  async head(storageKey: string): Promise<StoredObject | null> {
    const blob = this.blobClient(storageKey);
    if (!(await blob.exists())) return null;
    const properties = await blob.getProperties();
    return { sizeBytes: properties.contentLength ?? 0 };
  }

  async readStart(storageKey: string, length: number): Promise<Buffer> {
    return this.blobClient(storageKey).downloadToBuffer(0, length);
  }

  private delegationKeyValidUntil(
    signatureExpiresOn: Date,
  ): Promise<UserDelegationKey> {
    const cached = this.cachedDelegationKey;
    if (cached && cached.expiresOn > signatureExpiresOn) {
      return cached.key;
    }
    const startsOn = new Date(Date.now() - CLOCK_SKEW_ALLOWANCE_MILLISECONDS);
    const expiresOn = new Date(
      Date.now() + DELEGATION_KEY_LIFETIME_MILLISECONDS,
    );
    const key = this.blobServiceClient
      .getUserDelegationKey(startsOn, expiresOn)
      .catch((error: unknown) => {
        if (this.cachedDelegationKey?.key === key) {
          this.cachedDelegationKey = null;
        }
        throw error;
      });
    this.cachedDelegationKey = { expiresOn, key };
    return key;
  }
}
