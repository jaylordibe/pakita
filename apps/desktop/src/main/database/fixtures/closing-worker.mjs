// A database worker that answers `close` cleanly and then lets its thread end.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', (message) => {
  parentPort.postMessage({
    requestId: message.requestId,
    isSuccess: true,
    result: undefined,
  });
  if (message.type === 'close') {
    parentPort.close();
  }
});
