// Writes two files from the API's OpenAPI document, so the app checks a value
// without copying the API's rules:
// - src/shared/api/enums.ts: every named enum as a runtime list (a USFM book
//   code, say), typed against the generated types;
// - src/shared/api/constraints.ts: every field's published limits (lengths,
//   patterns, ranges, item counts), e.g. the longest verse text accepted.
// Run by `pnpm generate:api`; CI fails when either output is stale.
import { readFileSync, writeFileSync } from 'node:fs';

const [source, output, constraintsOutput] = process.argv.slice(2);
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

const CONSTRAINT_KEYS = [
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
];
const constraints = {};
for (const [name, schema] of schemas) {
  const fields = {};
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    const limits = Object.fromEntries(
      CONSTRAINT_KEYS.filter((key) => property[key] !== undefined).map(
        (key) => [key, property[key]],
      ),
    );
    if (Object.keys(limits).length > 0) fields[field] = limits;
  }
  if (Object.keys(fields).length > 0) constraints[name] = fields;
}
writeFileSync(
  constraintsOutput,
  [
    '// Generated from apps/api/openapi.json by scripts/generate-api-enums.mjs.',
    '// Do not edit: run `pnpm generate:api`.',
    "import type { components } from './openapi';",
    '',
    'interface FieldConstraints {',
    '  readonly minLength?: number;',
    '  readonly maxLength?: number;',
    '  readonly pattern?: string;',
    '  readonly minimum?: number;',
    '  readonly maximum?: number;',
    '  readonly minItems?: number;',
    '  readonly maxItems?: number;',
    '}',
    '',
    "/** Each request and response field's limits, as the API publishes them. */",
    `export const apiConstraints = ${JSON.stringify(constraints)} as const satisfies {`,
    "  readonly [Schema in keyof components['schemas']]?: Readonly<Record<string, FieldConstraints>>;",
    '};',
    '',
  ].join('\n'),
);
