import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  IpcChannel,
  IpcEvent,
  type LiveState,
  type ProjectorApi,
} from '../shared/ipc-contract';

// The projector window shows what the main process sends: it can read the
// live state and nothing else.
const projector: ProjectorApi = {
  getState: () => ipcRenderer.invoke(IpcChannel.liveGetState),
  onState: (listener) => {
    const wrapped = (_event: IpcRendererEvent, state: LiveState) =>
      listener(state);
    ipcRenderer.on(IpcEvent.liveState, wrapped);
    return () => {
      ipcRenderer.removeListener(IpcEvent.liveState, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('pakitaProjector', projector);
