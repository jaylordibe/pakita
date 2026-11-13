import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';

import type { IpcChannelName } from '../shared/ipc-contract';
import { isTrustedUrl } from './security-policy';

export class IpcRejectedError extends Error {
  constructor(reason: string) {
    super(`IPC request rejected: ${reason}`);
    this.name = 'IpcRejectedError';
  }
}

interface IpcSender {
  readonly senderFrame: { readonly url: string } | null;
  readonly sender: { readonly id: number; readonly mainFrame: unknown };
}

/**
 * Wraps a handler so it runs only for a trusted top-level frame of an allowed
 * window, and only on a payload its schema accepts. Every IPC handler in the
 * app is built through this, so no check can be forgotten on a new channel.
 */
export function createIpcHandler<Schema extends z.ZodType, Result>(options: {
  readonly schema: Schema;
  readonly trustedOrigins: ReadonlySet<string>;
  /** Which window (by web contents id) may use this channel. */
  readonly isAllowedSender: (senderId: number) => boolean;
  readonly handle: (payload: z.infer<Schema>) => Result | Promise<Result>;
}): (event: IpcSender, payload: unknown) => Promise<Result> {
  return async (event, payload) => {
    if (!options.isAllowedSender(event.sender.id)) {
      throw new IpcRejectedError('not allowed for this window');
    }
    const frame = event.senderFrame;
    if (!frame || !isTrustedUrl(frame.url, options.trustedOrigins)) {
      throw new IpcRejectedError('untrusted sender');
    }
    // A frame embedded in the page is never trusted to speak for it.
    if (frame !== event.sender.mainFrame) {
      throw new IpcRejectedError('not the top-level frame');
    }
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      throw new IpcRejectedError('invalid payload');
    }
    return options.handle(parsed.data);
  };
}

export function registerIpcHandler<Schema extends z.ZodType, Result>(
  ipcMain: IpcMain,
  channel: IpcChannelName,
  options: Parameters<typeof createIpcHandler<Schema, Result>>[0],
): void {
  const handler = createIpcHandler(options);
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) =>
    handler(event, payload),
  );
}
