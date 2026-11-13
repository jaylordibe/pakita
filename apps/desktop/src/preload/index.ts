import { contextBridge, ipcRenderer } from 'electron';

import { IpcChannel, type PakitaApi } from '../shared/ipc-contract';

// The renderer's ONLY access to the app: named functions, one per channel in
// the IPC contract. Never expose `ipcRenderer` itself, or a generic
// `invoke(channel, …)`: either would let page script reach every handler.
const pakita: PakitaApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IpcChannel.appGetVersion),
  },
  database: {
    getHealth: () => ipcRenderer.invoke(IpcChannel.databaseGetHealth),
  },
};

contextBridge.exposeInMainWorld('pakita', pakita);
