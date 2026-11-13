import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// DESIGN.md repeats the interface's colours and radii in its frontmatter (the
// format requires literal values). The source of truth is the renderer's
// style.css; this keeps the copy from drifting.
const root = join(__dirname, '..');
const css = readFileSync(join(root, 'src/renderer/src/style.css'), 'utf8');
const design = readFileSync(join(root, 'DESIGN.md'), 'utf8');

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim();

function cssTokens(): Map<string, string> {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const tokens = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens.set(name!, normalise(value!));
  }
  return tokens;
}

/** The quoted `key: 'value'` pairs of one top-level frontmatter group. */
function frontmatterGroup(group: string): Map<string, string> {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(design)?.[1] ?? '';
  const body =
    new RegExp(`^${group}:\\n((?:  .*\\n?)*)`, 'm').exec(frontmatter)?.[1] ??
    '';
  const entries = new Map<string, string>();
  for (const [, key, , value] of body.matchAll(
    /^ {2}([\w-]+):\s*(['"])(.*?)\2\s*$/gm,
  )) {
    entries.set(key!, normalise(value!));
  }
  return entries;
}

describe('DESIGN.md', () => {
  const tokens = cssTokens();

  it.each(['colors', 'rounded'])('states the same %s as style.css', (group) => {
    const entries = frontmatterGroup(group);
    expect(entries.size).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect({ key, value }).toEqual({ key, value: tokens.get(key) });
    }
  });
});
