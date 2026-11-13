import { rejectNullFields } from './reject-null-fields.util';

const dto = (fields: Record<string, unknown>) => fields;

describe('rejectNullFields', () => {
  it('refuses a null in a field that cannot hold one', () => {
    expect(() =>
      rejectNullFields({ name: null, artist: null }, ['name']),
    ).toThrow('Validation failed');
  });

  it('allows absent fields and nulls elsewhere', () => {
    expect(() =>
      rejectNullFields(dto({ artist: null }), ['name']),
    ).not.toThrow();
  });
});
