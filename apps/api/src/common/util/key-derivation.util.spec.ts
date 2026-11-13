import { deriveKey } from './key-derivation.util';

describe('deriveKey', () => {
  it('is deterministic for one secret and label', () => {
    expect(deriveKey('secret', 'use/v1', 32)).toEqual(
      deriveKey('secret', 'use/v1', 32),
    );
  });

  it('gives independent keys per label and per secret', () => {
    const key = deriveKey('secret', 'use/v1', 32);
    expect(deriveKey('secret', 'other/v1', 32)).not.toEqual(key);
    expect(deriveKey('other-secret', 'use/v1', 32)).not.toEqual(key);
  });

  it('has the requested length', () => {
    expect(deriveKey('secret', 'use/v1', 48)).toHaveLength(48);
  });
});
