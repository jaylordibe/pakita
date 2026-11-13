import { describe, expect, it } from 'vitest';

import { slugOf } from './slug';

describe('slugOf', () => {
  it('turns a church name into the API’s slug form', () => {
    expect(slugOf('Grace Church — North')).toBe('grace-church-north');
    expect(slugOf('  Iglesia de San José  ')).toBe('iglesia-de-san-jose');
    expect(slugOf('x'.repeat(70))).toHaveLength(60);
  });
});
