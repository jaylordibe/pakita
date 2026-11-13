// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // The main process, preload and tooling run on Node.
    files: [
      'src/main/**',
      'src/preload/**',
      'test/**',
      'scripts/**',
      '*.config.*',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // The renderer is a browser page with no Node access.
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      // Rendering HTML from data is how lyrics or a Bible import would inject
      // script into the operator or projector window. Text interpolation only.
      'vue/no-v-html': 'error',
    },
  },
  {
    // Only the preload may reach Electron from the renderer side, and the
    // renderer must never import main-process code.
    files: ['src/renderer/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*'],
              message:
                'The renderer has no Node or Electron access; go through window.pakita.',
            },
            {
              group: ['**/main/**', '**/preload/**'],
              message: 'The renderer may import only src/shared.',
            },
          ],
        },
      ],
    },
  },
  eslintPluginPrettierRecommended,
);
