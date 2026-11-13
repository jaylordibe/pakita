import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { z } from 'zod';

/**
 * Reads a small JSON file, returning `fallback` when it is missing or no
 * longer matches its schema (a damaged file must never stop the app from
 * starting).
 */
export function readJsonFile<Value>(
  path: string,
  schema: z.ZodType<Value>,
  fallback: Value,
): Value {
  if (!existsSync(path)) {
    return fallback;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Writes atomically: a crash mid-write leaves the previous file intact. */
export function writeJsonFile(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}
