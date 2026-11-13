/// <reference types="vite/client" />

import type { PakitaApi, ProjectorApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    /** The operator window's API (src/preload/index.ts). */
    readonly pakita: PakitaApi;
    /** The projector window's read-only API (src/preload/projector.ts). */
    readonly pakitaProjector: ProjectorApi;
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
