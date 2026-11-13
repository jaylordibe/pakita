import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiClient, ApiError, ServerUnreachableError } from './api-client';

const pingSchema = z.object({ isOk: z.boolean() });

function clientAnswering(response: Response | Error) {
  const fetchFunction = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
  return {
    client: new ApiClient('https://pakita.example.org', fetchFunction),
    fetchFunction,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ApiClient', () => {
  it('sends JSON with the bearer token and returns the validated body', async () => {
    const { client, fetchFunction } = clientAnswering(
      json(200, { isOk: true }),
    );

    await expect(
      client.request({
        method: 'POST',
        path: '/api/thing',
        schema: pingSchema,
        body: { name: 'x' },
        accessToken: 'token',
      }),
    ).resolves.toEqual({ isOk: true });

    const [url, init] = fetchFunction.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://pakita.example.org/api/thing');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe('{"name":"x"}');
  });

  it('turns the error envelope into an ApiError with its errorCode', async () => {
    const { client } = clientAnswering(
      json(401, {
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Wrong password',
      }),
    );
    const failure = client.request({
      method: 'POST',
      path: '/api/auth/login',
      schema: pingSchema,
    });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 401,
      errorCode: 'INVALID_CREDENTIALS',
      message: 'Wrong password',
    });
  });

  it('refuses a body of the wrong shape', async () => {
    const { client } = clientAnswering(json(200, { isOk: 'yes' }));
    await expect(
      client.request({ method: 'GET', path: '/api/thing', schema: pingSchema }),
    ).rejects.toMatchObject({ errorCode: null, status: 200 });
  });

  it('copes with an error page that is not JSON', async () => {
    const { client } = clientAnswering(
      new Response('<h1>Bad gateway</h1>', { status: 502 }),
    );
    await expect(
      client.request({ method: 'GET', path: '/api/thing', schema: pingSchema }),
    ).rejects.toMatchObject({ status: 502, errorCode: null });
  });

  it('reports an unreachable server distinctly', async () => {
    const { client } = clientAnswering(new TypeError('fetch failed'));
    await expect(
      client.request({ method: 'GET', path: '/api/thing', schema: pingSchema }),
    ).rejects.toBeInstanceOf(ServerUnreachableError);
  });
});
