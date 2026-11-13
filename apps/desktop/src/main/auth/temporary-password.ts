import { randomInt } from 'node:crypto';

import { apiConstraints } from '../../shared/api/constraints';

// Letters and digits a person can read aloud or copy by hand without
// confusing them: no 0/o, 1/l/i.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GROUP_COUNT = 4;
const GROUP_LENGTH = 4;

// The rule the server applies to a password it stores, generated from the
// API (`UpdatePasswordDto`), so a generated password always passes it.
const ACCOUNT_PASSWORD_PATTERN = new RegExp(
  apiConstraints.UpdatePasswordDto.newPassword.pattern,
);

/**
 * A one-time password for an account an administrator creates or resets,
 * e.g. `k7mq-x3vh-p9ta-2wre`: 16 characters from a 31-character alphabet
 * (about 79 bits) in groups, so it can be passed on by hand. The person
 * replaces it at their first sign-in. Uses the operating system's secure
 * random source.
 */
export function generateTemporaryPassword(
  random: (max: number) => number = (max) => randomInt(max),
): string {
  for (;;) {
    const groups = Array.from({ length: GROUP_COUNT }, () =>
      Array.from(
        { length: GROUP_LENGTH },
        () => ALPHABET[random(ALPHABET.length)],
      ).join(''),
    );
    const password = groups.join('-');
    // All letters or all digits would be refused; draw again (rare).
    if (ACCOUNT_PASSWORD_PATTERN.test(password)) return password;
  }
}
