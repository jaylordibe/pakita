import { Worker } from 'node:worker_threads';

import type { DatabaseHealth } from '../../shared/ipc-contract';
import {
  DatabaseHealthResult,
  type DatabaseWorkerRequest,
  DatabaseWorkerResponse,
} from './worker-protocol';

type PendingRequest = {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
};

/** How long `close()` waits for the worker to close the database cleanly. */
const CLOSE_TIMEOUT_MILLISECONDS = 5_000;

/**
 * The main process's handle on the database worker thread.
 *
 * Once the worker has stopped — it failed to open or migrate the database, or
 * it crashed — every request rejects at once with the reason, instead of
 * being posted to a thread that will never answer.
 */
export class DatabaseClient {
  private readonly worker: Worker;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 0;
  private stoppedError: Error | null = null;
  private isClosing = false;

  constructor(
    workerPath: string,
    databasePath: string,
    private readonly logError: (message: string) => void = console.error,
  ) {
    this.worker = new Worker(workerPath, { workerData: { databasePath } });
    this.worker.on('message', (message: unknown) => this.settle(message));
    this.worker.on('error', (error) => this.stop(error));
    this.worker.on('exit', (exitCode) =>
      this.stop(
        new Error(`The database worker stopped (exit code ${exitCode})`),
      ),
    );
  }

  async getHealth(): Promise<DatabaseHealth> {
    return DatabaseHealthResult.parse(await this.request({ type: 'health' }));
  }

  /**
   * Asks the worker to close the database (finishing its current statement),
   * and terminates it only if it does not answer in time.
   */
  async close(): Promise<void> {
    if (this.stoppedError) {
      return;
    }
    this.isClosing = true;
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), CLOSE_TIMEOUT_MILLISECONDS).unref(),
    );
    const outcome = await Promise.race([
      this.request({ type: 'close' }).catch(() => 'failed' as const),
      timeout,
    ]);
    // `undefined` is the worker's answer: database closed, thread exiting.
    const isClosedCleanly = outcome === undefined;
    if (!isClosedCleanly) {
      await this.worker.terminate();
    }
  }

  private request(
    request: Omit<DatabaseWorkerRequest, 'requestId'>,
  ): Promise<unknown> {
    if (this.stoppedError) {
      return Promise.reject(this.stoppedError);
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...request, requestId });
    });
  }

  private settle(message: unknown): void {
    const parsed = DatabaseWorkerResponse.safeParse(message);
    if (!parsed.success) {
      return;
    }
    const pending = this.pendingRequests.get(parsed.data.requestId);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(parsed.data.requestId);
    if (parsed.data.isSuccess) {
      pending.resolve(parsed.data.result);
    } else {
      pending.reject(new Error(parsed.data.errorMessage));
    }
  }

  private stop(error: Error): void {
    // The first reason is the real one; `exit` always follows `error`.
    if (!this.stoppedError) {
      this.stoppedError = error;
      if (!this.isClosing) {
        this.logError(`Local database unavailable: ${error.message}`);
      }
    }
    for (const pending of this.pendingRequests.values()) {
      pending.reject(this.stoppedError);
    }
    this.pendingRequests.clear();
  }
}
