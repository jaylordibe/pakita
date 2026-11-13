import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseClient } from './database-client';

const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

describe('DatabaseClient', () => {
  it('rejects requests with the reason once the worker has failed, and logs it', async () => {
    const logError = vi.fn();
    const client = new DatabaseClient(
      fixture('failing-worker.mjs'),
      ':memory:',
      logError,
    );

    // Before the failure is observed, and after it: both must reject.
    await expect(client.getHealth()).rejects.toThrow('newer Pakita');
    await expect(client.getHealth()).rejects.toThrow('newer Pakita');
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toContain('newer Pakita');
  });

  it('reports an unexpected stop once, and a requested close never', async () => {
    const onUnexpectedStop = vi.fn();
    const failing = new DatabaseClient(
      fixture('failing-worker.mjs'),
      ':memory:',
      () => {},
      onUnexpectedStop,
    );
    await expect(failing.getHealth()).rejects.toThrow();
    await vi.waitFor(() => expect(onUnexpectedStop).toHaveBeenCalledTimes(1));

    const onClosedStop = vi.fn();
    const closing = new DatabaseClient(
      fixture('closing-worker.mjs'),
      ':memory:',
      () => {},
      onClosedStop,
    );
    await closing.close();
    expect(onClosedStop).not.toHaveBeenCalled();
  });

  it('closes through the worker without logging an error', async () => {
    const logError = vi.fn();
    const client = new DatabaseClient(
      fixture('closing-worker.mjs'),
      ':memory:',
      logError,
    );

    await client.close();
    await expect(client.getHealth()).rejects.toThrow('stopped');
    expect(logError).not.toHaveBeenCalled();
  });
});
