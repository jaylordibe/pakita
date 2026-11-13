import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createIpcHandler, IpcRejectedError } from './ipc-registry';
import { APP_ORIGIN, createTrustedOrigins } from './security-policy';

function eventFrom(
  url: string,
  options: { isMainFrame?: boolean; senderId?: number } = {},
) {
  const frame = { url };
  const mainFrame = options.isMainFrame === false ? { url } : frame;
  return {
    senderFrame: frame,
    sender: { id: options.senderId ?? 1, mainFrame },
  };
}

describe('createIpcHandler', () => {
  const handle = vi.fn(
    (payload: { readonly name: string }) => `hello ${payload.name}`,
  );
  const handler = createIpcHandler({
    schema: z.object({ name: z.string().min(1) }).strict(),
    trustedOrigins: createTrustedOrigins(),
    // Only window 1 (the operator) may use this channel.
    isAllowedSender: (senderId) => senderId === 1,
    handle,
  });

  it('runs the handler for a valid payload from the app', async () => {
    await expect(
      handler(eventFrom(`${APP_ORIGIN}/index.html`), { name: 'Pakita' }),
    ).resolves.toBe('hello Pakita');
  });

  it.each([
    undefined,
    null,
    {},
    { name: '' },
    { name: 42 },
    { name: 'x', extra: true },
  ])('rejects the payload %j without running the handler', async (payload) => {
    handle.mockClear();
    await expect(
      handler(eventFrom(`${APP_ORIGIN}/index.html`), payload),
    ).rejects.toThrow(IpcRejectedError);
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects a sender that is not the app', async () => {
    handle.mockClear();
    await expect(
      handler(eventFrom('https://example.com/'), { name: 'x' }),
    ).rejects.toThrow('untrusted sender');
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects a sender frame that has gone away', async () => {
    const event = { senderFrame: null, sender: { id: 1, mainFrame: {} } };
    await expect(handler(event, { name: 'x' })).rejects.toThrow(
      'untrusted sender',
    );
  });

  it('rejects an embedded frame even on the app origin', async () => {
    handle.mockClear();
    await expect(
      handler(eventFrom(`${APP_ORIGIN}/index.html`, { isMainFrame: false }), {
        name: 'x',
      }),
    ).rejects.toThrow('not the top-level frame');
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects another window of the app, even from the app origin', async () => {
    handle.mockClear();
    await expect(
      handler(eventFrom(`${APP_ORIGIN}/projector.html`, { senderId: 2 }), {
        name: 'x',
      }),
    ).rejects.toThrow('not allowed for this window');
    expect(handle).not.toHaveBeenCalled();
  });
});
