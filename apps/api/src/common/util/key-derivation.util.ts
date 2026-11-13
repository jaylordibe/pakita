import { hkdfSync } from 'node:crypto';

/**
 * A key derived from an existing secret (`JWT_SECRET`) for one named use, so a
 * new use needs no configuration edit.
 *
 * HKDF (RFC 5869) with a distinct `label` per use gives keys that are
 * independent of each other and of the secret's own use: knowing one derived
 * key reveals neither the secret nor any other key. Rotating the secret
 * rotates every key derived from it.
 */
export function deriveKey(
  secret: string,
  label: string,
  length: number,
): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.alloc(0),
      label,
      length,
    ),
  );
}
