/// <reference types="vite/client" />

import type { PakitaApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    readonly pakita: PakitaApi;
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
