import { isIP } from 'node:net';
import * as Joi from 'joi';
import {
  parseMcpAllowedOrigins,
  parseMcpRedirectOrigins,
} from '../common/util/mcp-config.util';
import { isTrustedProxyList } from '../common/util/trusted-proxy.util';
import { FILE_UPLOAD_DEFAULTS } from './file-upload.defaults';

// The test suite never reaches a real provider: object storage is billed and
// holds real files. Tests never read `.env` (`isEnvFileIgnored`),
// so the stub defaults hold; this refuses the boot if `.env.test` or the
// shell names a real one anyway.
function refusedInTest(...realProviders: string[]): Joi.WhenOptions {
  return {
    is: 'test',
    then: Joi.string()
      .invalid(...realProviders)
      .messages({
        'any.invalid':
          '{{#label}} cannot be a real provider under NODE_ENV=test — the test suite must never call one.',
      }),
  };
}

// A public address clients reach, so production must name the real public
// host: the localhost default below would boot fine and hand out an address
// nobody else can reach. Judged on the URL as a browser parses
// it, so every spelling of a loopback or bare address is caught (`127.1`,
// `2130706433`, `[::ffff:127.0.0.1]`, `localhost.`, `*.localhost`), and so are
// credentials in the URL. A deployment links to a hostname, never to an IP.
function isPublicHostUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  const unbracketed = hostname.replace(/^\[|\]$/g, '');
  return (
    hostname !== '' &&
    hostname !== 'localhost' &&
    !hostname.endsWith('.localhost') &&
    isIP(unbracketed) === 0
  );
}

function publicUrlInProduction(defaultUrl: string): Joi.StringSchema {
  return Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .pattern(/[^/]$/, { name: 'no-trailing-slash' })
    .default(defaultUrl)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .uri({ scheme: ['https'] })
        .custom((value: string, helpers) =>
          isPublicHostUrl(value) ? value : helpers.error('publicUrl.host'),
        )
        .required()
        .messages({
          'any.required':
            '{{#label}} is required in production — it names the server in the MCP sign-in and its metadata, and the default points at localhost.',
          'string.uriCustomScheme':
            '{{#label}} must be an https:// URL in production.',
          'publicUrl.host':
            '{{#label}} must name the public hostname in production — not localhost, an IP address, or a URL with credentials.',
        }),
    });
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  SERVICE_NAME: Joi.string()
    .pattern(/^[a-z][a-z0-9_-]*$/)
    .required()
    .description(
      'lowercase identifier; also used as the Postgres database name',
    ),

  // The API's public base URL, with scheme and no trailing slash. The MCP
  // OAuth issuer and resource are derived from it.
  API_BASE_URL: publicUrlInProduction('http://localhost:3000/api'),

  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_NAME: Joi.string()
    .pattern(/^[a-z][a-z0-9_-]*$/)
    .required()
    .description('Postgres database name; defaults to ${SERVICE_NAME}'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  // Connections THIS process may hold open to Postgres.
  //
  // The number that matters is not this one, it is the product:
  //
  //   (API max instances × DATABASE_POOL_MAX)
  //     + (worker max instances × DATABASE_POOL_MAX)
  //     + migration job connections
  //     + any interactive/admin session
  //     < the database's max_connections (minus its superuser reserve)
  //
  // Autoscaling is what makes an implicit default dangerous: the per-process
  // number is multiplied by something nobody sets in this file. Capped at 100
  // because a single process wanting more than that is a sign the work belongs
  // on the queue, not in more connections.
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
  // How long a caller waits for a free connection before failing. Bounded so a
  // saturated pool surfaces as a fast error instead of a request that hangs
  // until the client times out — and so an instance cannot sit past its own
  // request deadline waiting for a connection that is not coming.
  DATABASE_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(60_000)
    .default(5_000),
  // How long an idle connection is held before being returned to the database.
  // Short enough that an instance that has scaled down its traffic stops
  // occupying connections its siblings need.
  DATABASE_IDLE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(600_000)
    .default(30_000),

  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_PASSWORD: Joi.string().min(16).required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required()
    // The scheme and REDIS_TLS_ENABLED must agree. Checked here as well as in
    // `buildRedisTransportOptions` so the failure lands at config validation
    // with the variable named, rather than at the first connection attempt.
    .when('REDIS_TLS_ENABLED', {
      is: 'true',
      then: Joi.string()
        .pattern(/^rediss:\/\//)
        .messages({
          'string.pattern.base':
            'REDIS_TLS_ENABLED is true, so REDIS_URL must use the rediss:// scheme. A redis:// URL would connect in plaintext.',
        }),
      otherwise: Joi.string()
        .pattern(/^redis:\/\//)
        .messages({
          'string.pattern.base':
            'REDIS_URL uses rediss:// but REDIS_TLS_ENABLED is not true. Set REDIS_TLS_ENABLED=true so the TLS options (CA, verification) are actually applied.',
        }),
    }),

  // Whether to dial Redis over TLS. Required for a managed Redis with
  // in-transit encryption; left off for the local container, which is
  // reachable only on the developer's own machine.
  //
  // Kept in lockstep with REDIS_URL's scheme rather than allowed to disagree
  // with it. Two statements of the same fact that can diverge is how a
  // deployment ends up believing traffic is encrypted when it is not — the one
  // failure here that produces no error and no symptom.
  REDIS_TLS_ENABLED: Joi.string()
    .valid('true', 'false')
    .allow('')
    .default('false'),
  // PEM-encoded CA certificate for verifying the Redis server certificate.
  //
  // OPTIONAL, and optional on purpose: a Redis whose certificate chains to a
  // publicly-trusted root needs nothing here, while a managed Redis that signs
  // with a private or per-instance CA must supply it. Certificate verification
  // itself is NOT configurable — `rejectUnauthorized` is hard-coded true in
  // `common/redis/redis-connection.ts` — so the only question this variable
  // answers is which trust anchor to verify against.
  //
  // Newlines may be literal or backslash-escaped; the builder normalises both,
  // because Secret Manager and `env_file` each flatten a PEM to one line.
  REDIS_TLS_CA: Joi.string()
    .allow('')
    .optional()
    .when('REDIS_TLS_ENABLED', {
      is: 'false',
      // A CA with TLS off is not merely redundant, it is evidence that somebody
      // configured half of an encrypted connection and believes they configured
      // all of it.
      then: Joi.string().valid('').messages({
        'any.only':
          'REDIS_TLS_CA is set but REDIS_TLS_ENABLED is false — the certificate would be ignored and the connection would be plaintext. Set REDIS_TLS_ENABLED=true and use a rediss:// URL.',
      }),
    }),

  // Whether THIS process consumes queued jobs. Producing is never gated, so
  // false yields a pure API instance that still enqueues everything.
  QUEUE_WORKER_ENABLED: Joi.boolean().default(true),
  // Jobs a worker runs concurrently, per queue. The lever for a growing
  // backlog; capped because an unbounded value in a combined API+worker
  // process starves HTTP request handling.
  QUEUE_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(100).default(10),

  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .invalid(
      // Reject the template's placeholder value verbatim, so a checkout that
      // never rotated it cannot silently deploy with the default secret.
      '136542716fe8f487721f5e2a3b48574cc3282c086487f28600bda8057f37c92e96c58e64ebe347d29517a2862c6694e2',
    )
    .messages({
      'any.invalid':
        'JWT_SECRET is the template default — regenerate with `openssl rand -hex 48`.',
    }),
  // Access-token lifetime. Short by default and deliberately so: a stateless
  // token cannot be withdrawn once signed, so nothing but its expiry bounds a
  // leaked one. Clients are expected to refresh, not to hold this for days.
  JWT_EXPIRES_IN: Joi.string().default('15m'),

  // Refresh-token lifetime in whole days — the actual "keep me signed in"
  // window, and the one users feel. Unlike the access token this IS revocable
  // (see the `refresh_tokens` table), so a long value here is a usability
  // choice rather than an unbounded liability.
  REFRESH_TOKEN_EXPIRES_IN_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(365)
    .default(30),

  // OpenTelemetry collector base URL, e.g. http://otel-collector:4318. Empty
  // disables telemetry entirely — the SDK never starts, so a fresh clone and
  // the e2e suite pay nothing.
  //
  // Read directly from process.env in src/telemetry.ts (which runs before the
  // Nest container exists), NOT through ConfigService. Declared here anyway so
  // it is documented and validated alongside every other key rather than being
  // an undeclared string someone discovers in the source.
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().allow('').default(''),

  // Backstop TTL for the per-user permission-grants cache in Redis. Role and
  // membership changes invalidate explicitly, so this only bounds the window
  // of a missed invalidation. Lower it if you distrust the invalidation paths;
  // raising it past a few minutes trades staleness for very little.
  AUTHORIZATION_GRANTS_CACHE_TTL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(3600)
    .default(300),

  // Whether the Cloudflare-injected request headers may be believed.
  //
  // Defaults to `false`, and that default is the point: these headers are
  // forgeable by anyone who can reach the origin directly, and they are
  // persisted into `audit_logs`. A fork that deploys without restricting the
  // origin to Cloudflare's ranges records no country or ray id rather than
  // ones the caller chose. Turn it on only behind an edge that admits nothing
  // but Cloudflare's ranges.
  TRUST_CLOUDFLARE_HEADERS: Joi.string()
    .valid('true', 'false')
    .allow('')
    .default('false'),

  // How long a workspace invitation code stays redeemable. Only the invited
  // account can redeem it, but a copy left in a chat history should not stay
  // worth something for ever. Capped at 30 days — anything longer should be
  // re-issued.
  WORKSPACE_INVITATION_EXPIRES_IN_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(30)
    .default(7),

  // ── Object storage ─────────────────────────────────────────────────────────
  // `stub` (default) persists nothing and returns `stub://…` URLs, so a fresh
  // clone and the whole test suite run with no cloud account and no credential.
  // `s3` (AWS S3 and every S3-compatible backend), `gcs` and `azure` are equal
  // citizens — no provider is privileged and only the selected one's SDK is
  // loaded at runtime.
  //
  // NOTICE WHAT IS ABSENT: there is no variable for an access key, a
  // service-account JSON, an account key or a connection string, for any
  // provider. Each adapter authenticates through its platform's keyless
  // identity chain (IAM role / instance profile / IRSA, Application Default
  // Credentials, Managed Identity). Long-lived cloud credentials are not an
  // input this application accepts.
  //
  // Each provider's fields are required ONLY when that provider is selected, so
  // choosing one never forces the others' configuration to exist.
  STORAGE_PROVIDER: Joi.string()
    .valid('stub', 's3', 'gcs', 'azure')
    .default('stub')
    .when('NODE_ENV', refusedInTest('s3', 'gcs', 'azure'))
    // The stub stores nothing, yet answers every upload with 201 and a file id
    // a profile then points at — in production that is silent data loss.
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().invalid('stub').required().messages({
        'any.invalid':
          'STORAGE_PROVIDER cannot be "stub" in production — it stores nothing, so every uploaded file would be lost. Configure s3, gcs or azure.',
      }),
    }),

  // Default lifetime of a signed read URL. Clamped to [30s, 1h] in code
  // whatever is set here — a signed URL is an unrevocable bearer credential, so
  // its lifetime is the entire security boundary and is not left to
  // configuration alone.
  STORAGE_SIGNED_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(30)
    .max(3600)
    .default(300),

  // The ceiling on every storage call — an upload, a delete, a signature. At
  // least a second ("15s" would parse as 15 ms and fail nearly every call), at
  // most two minutes (an upload waits inside it holding a database
  // connection).
  STORAGE_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(120_000)
    .default(15_000),

  // S3 and S3-compatible (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO).
  STORAGE_S3_BUCKET: Joi.string().when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.string().min(3).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  // Optional even for `s3`: the SDK resolves the region from AWS_REGION, the
  // shared config file or instance metadata. Requiring it here would break the
  // hosts that already answer the question.
  STORAGE_S3_REGION: Joi.string().allow('').optional(),
  // Set for an S3-compatible backend; leave empty for AWS S3 itself.
  STORAGE_S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .optional(),
  STORAGE_S3_FORCE_PATH_STYLE: Joi.string()
    .valid('true', 'false')
    .allow('')
    .default('false'),

  // Google Cloud Storage.
  STORAGE_GCS_BUCKET: Joi.string().when('STORAGE_PROVIDER', {
    is: 'gcs',
    then: Joi.string().min(3).required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  // Optional: supplied it pins the project, omitted ADC decides — which is what
  // a local `gcloud auth` session expects.
  STORAGE_GCS_PROJECT_ID: Joi.string().allow('').optional(),

  // Azure Blob Storage.
  STORAGE_AZURE_ACCOUNT_NAME: Joi.string().when('STORAGE_PROVIDER', {
    is: 'azure',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  STORAGE_AZURE_CONTAINER: Joi.string().when('STORAGE_PROVIDER', {
    is: 'azure',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),

  // ── File uploads (`POST /files`) ─────────────────────────────────────────
  // Hard per-file ceiling in bytes, applied while the request streams in; each
  // upload purpose also has its own lower limit in code. Bounded above because
  // the file is held in memory until it is processed.
  FILE_UPLOAD_MAX_BYTES: Joi.number()
    .integer()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(FILE_UPLOAD_DEFAULTS.maxUploadBytes),
  // How long an uploaded, unattached file stays attachable before the cleanup
  // job deletes it.
  FILE_UPLOAD_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(7 * 24 * 60 * 60)
    .default(FILE_UPLOAD_DEFAULTS.uploadTtlSeconds),
  // Largest width × height an uploaded image may declare. Refused from the
  // header, before decoding.
  FILE_IMAGE_MAX_PIXELS: Joi.number()
    .integer()
    .min(1)
    .max(268_402_689)
    .default(FILE_UPLOAD_DEFAULTS.imageMaxPixels),

  // Whether `/api/docs` is served. Only ever NARROWS: production is hard-off in
  // `configuration.ts` regardless of this value, so setting it to `true` there
  // does nothing. It exists so a staging deployment with no reverse proxy in
  // front of it can hide the docs from the internet without a code change —
  // Basic Auth at a reverse proxy can do that job, but a managed container
  // platform may have no proxy to configure.
  SWAGGER_ENABLED: Joi.string()
    .valid('true', 'false')
    .allow('')
    .default('true'),

  // In production, refuse the wildcard origin — Same-Origin with
  // credentials: true is broken in browsers against `*`, and leaving the
  // wildcard in prod signals a CORS misconfiguration waiting to bite.
  CORS_ORIGIN: Joi.string()
    .default('*')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().invalid('*').required().messages({
        'any.invalid':
          'CORS_ORIGIN cannot be "*" in production — set an explicit origin list.',
      }),
    }),

  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),

  // The hops whose X-Forwarded-For Express believes: "false" (no proxy — the
  // local default) or a list isTrustedProxyList accepts. Production must name
  // its hops: "false" behind a proxy puts every caller in the proxy's one
  // rate-limit bucket. What to list: docs/deployment/README.md.
  TRUST_PROXY: Joi.string()
    .trim()
    .default('false')
    .custom((value: string, helpers) =>
      value === 'false' || isTrustedProxyList(value)
        ? value
        : helpers.error('trustProxy.format'),
    )
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().invalid('false').required(),
    })
    .messages({
      'trustProxy.format':
        'TRUST_PROXY must be "false" or a comma-separated list of IP addresses and CIDR ranges of the trusted proxy hops (e.g. "172.30.0.10"). Hop counts, "true", keywords and hostnames are not accepted.',
      'any.invalid':
        'TRUST_PROXY must list the trusted proxy hops in production (e.g. "172.30.0.10"); "false" puts every caller behind the proxy in one rate-limit bucket.',
    }),

  // Browser origins allowed to call `/api/mcp`. Empty refuses any request
  // carrying an `Origin` header.
  MCP_ALLOWED_ORIGINS: Joi.string()
    .allow('')
    .default('')
    .custom((value: string, helpers) =>
      parseMcpAllowedOrigins(value) === null
        ? helpers.error('mcpAllowedOrigins.format')
        : value,
    )
    .messages({
      'mcpAllowedOrigins.format':
        'MCP_ALLOWED_ORIGINS must be comma-separated origins such as "https://app.example.com" (scheme, host and optional port; no path).',
    }),

  // The MCP OAuth authorization server (docs/mcp.md). An access token lives
  // MCP_OAUTH_ACCESS_TOKEN_TTL_MINUTES; the client renews it with a rotating
  // refresh token for at most MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS from sign-in.
  MCP_OAUTH_ACCESS_TOKEN_TTL_MINUTES: Joi.number()
    .integer()
    .min(5)
    .max(24 * 60)
    .default(60),
  MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(90)
    .default(30),

  // https origins an MCP client may register as its OAuth redirect. Empty
  // allows any https origin; loopback (Claude Code) is always allowed.
  MCP_OAUTH_REDIRECT_DOMAINS: Joi.string()
    .allow('')
    .default('')
    .custom((value: string, helpers) =>
      parseMcpRedirectOrigins(value) === null
        ? helpers.error('mcpRedirectDomains.format')
        : value,
    )
    .messages({
      'mcpRedirectDomains.format':
        'MCP_OAUTH_REDIRECT_DOMAINS must be comma-separated https origins such as "https://claude.ai" (scheme, host and optional port; no path).',
    }),
});
