import { describe, expect, it } from 'vitest';

import { apiConstraints } from '../../shared/api/constraints';
import { generateTemporaryPassword } from './temporary-password';

const limits = apiConstraints.UpdatePasswordDto.newPassword;

describe('generateTemporaryPassword', () => {
  it('produces four groups of four readable characters', () => {
    expect(generateTemporaryPassword()).toMatch(
      /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){3}$/,
    );
  });

  it('always passes the password rule the server applies', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = generateTemporaryPassword();
      expect(password.length).toBeGreaterThanOrEqual(limits.minLength);
      expect(password.length).toBeLessThanOrEqual(limits.maxLength);
      expect(password).toMatch(new RegExp(limits.pattern));
    }
  });

  it('draws again when a draw has no digit', () => {
    // First draw: only letters ('a' is index 0); then only alternating.
    const draws = [...Array<number>(16).fill(0)];
    let call = 0;
    const random = (max: number) =>
      call < draws.length ? draws[call++]! : (call++ % 2) * (max - 1);
    const password = generateTemporaryPassword(random);
    expect(password).toMatch(/\d/);
    expect(call).toBeGreaterThan(16);
  });

  it('differs between calls', () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });
});
