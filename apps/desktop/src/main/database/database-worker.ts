// Runs in a worker thread, never on the main process. better-sqlite3 is
// synchronous: a large write (a whole Bible translation) on the main thread
// would freeze IPC — and with it the operator's controls — for its duration.
// The main process keeps what is on screen in memory and never waits on this
// thread to present.
import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';

import { BibleStore } from './bible-store';
import { LATEST_SCHEMA_VERSION, migrateDatabase } from './migrations';
import { SongStore } from './song-store';
import {
  DatabaseWorkerData,
  DatabaseWorkerRequest,
  type DatabaseWorkerResponse,
} from './worker-protocol';

if (!parentPort) {
  throw new Error('database-worker must run as a worker thread');
}
const port = parentPort;

const { databasePath } = DatabaseWorkerData.parse(workerData);
const database = new Database(databasePath);
// WAL: readers never block the writer and vice versa, and a crash mid-write
// leaves the last committed state intact.
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
migrateDatabase(database);
const songs = new SongStore(database);
const bible = new BibleStore(database);

function handle(request: DatabaseWorkerRequest): unknown {
  switch (request.type) {
    case 'health':
      return {
        journalMode: String(database.pragma('journal_mode', { simple: true })),
        schemaVersion: Number(
          database.pragma('user_version', { simple: true }),
        ),
        latestSchemaVersion: LATEST_SCHEMA_VERSION,
      };
    case 'close':
      database.close();
      return undefined;
    case 'getSyncState':
      return songs.getSyncState(request.workspaceId);
    case 'applySyncPage':
      songs.applySyncPage(
        request.workspaceId,
        request.epoch,
        request.nextCursor,
        request.songs,
      );
      return undefined;
    case 'beginResync':
      songs.beginResync(request.workspaceId, request.epoch);
      return undefined;
    case 'finishResync':
      songs.finishResync(request.workspaceId);
      return undefined;
    case 'listSongs':
      return songs.listSongs(
        request.workspaceId,
        request.search,
        request.isArchived,
      );
    case 'getSong':
      return songs.getSong(request.workspaceId, request.songId);
    case 'listBibleTranslations':
      return bible.listTranslations();
    case 'replaceBibleTranslation':
      bible.replaceTranslation(request.content);
      return undefined;
    case 'removeBibleTranslation':
      bible.removeTranslation(request.translationId);
      return undefined;
    case 'listBibleBooks':
      return bible.listBooks(request.translationId);
    case 'getBiblePassage':
      return bible.getPassage(
        request.translationId,
        request.bookCode,
        request.start,
        request.end,
      );
    case 'searchBible':
      return bible.search(request.translationId, request.search);
  }
}

port.on('message', (message: unknown) => {
  const parsed = DatabaseWorkerRequest.safeParse(message);
  if (!parsed.success) {
    return;
  }
  let response: DatabaseWorkerResponse;
  try {
    response = {
      requestId: parsed.data.requestId,
      isSuccess: true,
      result: handle(parsed.data),
    };
  } catch (error) {
    response = {
      requestId: parsed.data.requestId,
      isSuccess: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  port.postMessage(response);
  // After a clean close, let the thread end on its own.
  if (parsed.data.type === 'close' && response.isSuccess) {
    port.close();
  }
});
