import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { resolve } from 'node:path';

const DEVELOPMENT_STYLE_SOURCE = "style-src 'self' 'unsafe-inline'";

/**
 * Vite injects styles inline only while developing; a production build puts
 * them in a .css file. So the shipped page's CSP drops 'unsafe-inline', and
 * the build fails if the policy it expects to tighten is not there.
 */
function productionContentSecurityPolicy(): Plugin {
  return {
    name: 'pakita:production-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(DEVELOPMENT_STYLE_SOURCE)) {
        throw new Error(
          `index.html no longer contains "${DEVELOPMENT_STYLE_SOURCE}"; update this plugin.`,
        );
      }
      return html.replace(DEVELOPMENT_STYLE_SOURCE, "style-src 'self'");
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        // The database runs in its own worker thread, so it is its own entry
        // (out/main/database-worker.js), loaded by DatabaseClient.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'database-worker': resolve(
            __dirname,
            'src/main/database/database-worker.ts',
          ),
        },
      },
    },
  },
  // CommonJS (the default without "type": "module"): a sandboxed preload
  // cannot load an ES module, nor a shared chunk — so each preload is built
  // on its own (`isolatedEntries`), self-contained. One per window kind.
  preload: {
    build: {
      isolatedEntries: true,
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          projector: resolve(__dirname, 'src/preload/projector.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [vue(), productionContentSecurityPolicy()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          projector: resolve(__dirname, 'src/renderer/projector.html'),
        },
      },
    },
  },
});
