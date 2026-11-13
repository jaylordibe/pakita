import type { z } from 'zod';

import { errorEnvelopeSchema } from './api-schemas';

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

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
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** A path under the server's origin, e.g. `/api/public/server-info`. */
  readonly path: string;
  /** Validates the response body; omitted for a body-less response. */
  readonly schema?: z.ZodType<Result>;
  readonly body?: unknown;
  readonly accessToken?: string;
  readonly headers?: Readonly<Record<string, string>>;
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
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
    let body: unknown;
    try {
      body = await response.json();
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
  return new ApiError(response.status, envelope.data.errorCode, message);
}
