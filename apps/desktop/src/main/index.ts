import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';

import { IpcChannel } from '../shared/ipc-contract';
import { DatabaseClient } from './database/database-client';
import { registerIpcHandler } from './ipc-registry';
import {
  installWebContentsGuards,
  registerAppSchemePrivileges,
  serveRendererFromAppScheme,
} from './security';
import {
  APP_ORIGIN,
  createSecureWebPreferences,
  createTrustedOrigins,
} from './security-policy';

// electron-vite sets this only while `pnpm dev` runs; a packaged app never
// trusts a development server. An empty value means "none", not a URL.
const developmentServerUrl = app.isPackaged
  ? undefined
  : process.env.ELECTRON_RENDERER_URL || undefined;
const trustedOrigins = createTrustedOrigins(developmentServerUrl);

// The end-to-end tests run against a throwaway profile. Honoured only in an
// unpackaged build, so it can never redirect a church's real data.
if (!app.isPackaged && process.env.PAKITA_TEST_USER_DATA_DIRECTORY) {
  app.setPath('userData', process.env.PAKITA_TEST_USER_DATA_DIRECTORY);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppSchemePrivileges();
  void app.whenReady().then(start);
}

let operatorWindow: BrowserWindow | null = null;

async function start(): Promise<void> {
  installWebContentsGuards(trustedOrigins);
  serveRendererFromAppScheme(join(__dirname, '../renderer'));

  const database = new DatabaseClient(
    join(__dirname, 'database-worker.js'),
    join(app.getPath('userData'), 'pakita.sqlite'),
  );
  // Close the database cleanly before the process exits: hold the quit once,
  // let the worker finish its statement and close, then quit for real.
  let isDatabaseClosed = false;
  app.on('before-quit', (event) => {
    if (isDatabaseClosed) {
      return;
    }
    event.preventDefault();
    void database.close().finally(() => {
      isDatabaseClosed = true;
      app.quit();
    });
  });

  const noPayload = z.undefined();
  registerIpcHandler(ipcMain, IpcChannel.appGetVersion, {
    schema: noPayload,
    trustedOrigins,
    handle: () => app.getVersion(),
  });
  registerIpcHandler(ipcMain, IpcChannel.databaseGetHealth, {
    schema: noPayload,
    trustedOrigins,
    handle: () => database.getHealth(),
  });

  app.on('second-instance', () => {
    if (operatorWindow) {
      if (operatorWindow.isMinimized()) {
        operatorWindow.restore();
      }
      operatorWindow.focus();
    }
  });

  operatorWindow = createOperatorWindow();
}

function createOperatorWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Pakita',
    show: false,
    webPreferences: createSecureWebPreferences(
      join(__dirname, '../preload/index.js'),
    ),
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    operatorWindow = null;
  });
  void window.loadURL(developmentServerUrl ?? `${APP_ORIGIN}/index.html`);
  return window;
}

app.on('window-all-closed', () => {
  app.quit();
});
