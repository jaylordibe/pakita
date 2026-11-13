// Writes src/shared/api/enums.ts: every named enum in the API's OpenAPI
// document as a runtime list, typed against the generated types, so the app
// can check a value (a USFM book code, say) without copying the API's list.
// Run by `pnpm generate:api`; CI fails when the output is stale.
import { readFileSync, writeFileSync } from 'node:fs';

const [source, output] = process.argv.slice(2);
const document = JSON.parse(readFileSync(source, 'utf8'));

const lines = [
  '// Generated from apps/api/openapi.json by scripts/generate-api-enums.mjs.',
  '// Do not edit: run `pnpm generate:api`.',
  "import type { components } from './openapi';",
  '',
];
const schemas = Object.entries(document.components?.schemas ?? {}).sort(
  ([first], [second]) => first.localeCompare(second),
);
for (const [name, schema] of schemas) {
  if (!Array.isArray(schema.enum)) continue;
  const constant = `${name[0].toLowerCase()}${name.slice(1)}Values`;
  lines.push(
    `export const ${constant} = ${JSON.stringify(schema.enum)} as const satisfies ReadonlyArray<components['schemas']['${name}']>;`,
    '',
  );
}
writeFileSync(output, lines.join('\n'));
