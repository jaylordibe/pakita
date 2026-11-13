import type { z } from 'zod';

import { errorEnvelopeSchema, validationDetailsSchema } from './api-schemas';

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
/** Above any ordinary answer (a page of 50 long songs); larger is refused. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export type FetchFunction = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** A request that reached the server and was refused. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The server could not be reached (offline, DNS, timeout, TLS). */
export class ServerUnreachableError extends Error {
  constructor(cause: unknown) {
    super('The church server could not be reached.', { cause });
    this.name = 'ServerUnreachableError';
  }
}

export interface ApiRequest<Result> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** A path under the server's origin, e.g. `/api/public/server-info`. */
  readonly path: string;
  /** Validates the response body; omitted for a body-less response. */
  readonly schema?: z.ZodType<Result>;
  readonly body?: unknown;
  readonly accessToken?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Overrides the default timeout, for a large download. */
  readonly timeoutMilliseconds?: number;
  /** Overrides the default response size limit, for a large download. */
  readonly maxResponseBytes?: number;
}

/**
 * Talks to one Pakita server. Every response body is validated against its
 * schema before anything uses it: the server is trusted for content, never
 * for shape.
 */
export class ApiClient {
  constructor(
    readonly origin: string,
    private readonly fetchFunction: FetchFunction,
  ) {}

  async request<Result>(request: ApiRequest<Result>): Promise<Result> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...request.headers,
    };
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (request.accessToken) {
      headers.Authorization = `Bearer ${request.accessToken}`;
    }

    let response: Response;
    try {
      response = await this.fetchFunction(`${this.origin}${request.path}`, {
        method: request.method,
        headers,
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(
          request.timeoutMilliseconds ?? REQUEST_TIMEOUT_MILLISECONDS,
        ),
        // Never follow a redirect off the server the operator chose.
        redirect: 'error',
      });
    } catch (error) {
      throw new ServerUnreachableError(error);
    }

    if (!response.ok) {
      throw await toApiError(response);
    }
    if (!request.schema) {
      return undefined as Result;
    }
    const maxBytes = request.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > maxBytes) {
      await response.body?.cancel();
      throw new ApiError(
        response.status,
        null,
        'The server sent a response too large for Pakita to read.',
      );
    }
    let body: unknown;
    try {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new Error('Response too large');
      }
      body = JSON.parse(text);
    } catch {
      throw new ApiError(
        response.status,
        null,
        'The server sent a response Pakita could not read.',
      );
    }
    const parsed = request.schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        null,
        'The server sent a response Pakita did not expect. Is it a compatible Pakita server?',
      );
    }
    return parsed.data;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: a proxy's error page, for instance.
  }
  const envelope = errorEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return new ApiError(
      response.status,
      null,
      `The server answered ${response.status}.`,
    );
  }
  const message = Array.isArray(envelope.data.message)
    ? envelope.data.message.join(' ')
    : (envelope.data.message ?? `The server answered ${response.status}.`);
  // "Validation failed" alone does not say what to change; the details do.
  const details =
    envelope.data.errorCode === 'VALIDATION_FAILED'
      ? validationDetailsSchema.safeParse(envelope.data.details)
      : null;
  const reasons = details?.success
    ? details.data.flatMap((detail) => detail.constraints)
    : [];
  return new ApiError(
    response.status,
    envelope.data.errorCode,
    reasons.length > 0 ? `${message}: ${reasons.join('; ')}.` : message,
  );
}
