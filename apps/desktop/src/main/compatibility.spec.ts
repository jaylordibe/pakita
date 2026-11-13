import { describe, expect, it } from 'vitest';

import {
  checkCompatibility,
  compareVersions,
  REQUIRED_API_LEVEL,
} from './compatibility';

const serverInfo = {
  product: 'pakita' as const,
  serverVersion: '1.2.0',
  apiLevel: REQUIRED_API_LEVEL,
  minimumDesktopVersion: '1.0.0',
};

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['1.9.0', '1.10.0', -1],
    ['2.0.0-beta.1', '2.0.0', 0],
    ['0.0.0', '0.0.1', -1],
  ])('%s vs %s → %i', (first, second, expected) => {
    expect(compareVersions(first, second)).toBe(expected);
  });
});

describe('checkCompatibility', () => {
  it('accepts a server at the required level and an allowed desktop', () => {
    expect(checkCompatibility(serverInfo, '1.0.0').status).toBe('compatible');
    expect(
      checkCompatibility(
        { ...serverInfo, apiLevel: REQUIRED_API_LEVEL + 1 },
        '1.4.0',
      ).status,
    ).toBe('compatible');
  });

  it('asks for a server update when the server is behind', () => {
    expect(
      checkCompatibility({ ...serverInfo, apiLevel: 0 }, '1.0.0'),
    ).toMatchObject({ status: 'update-server' });
  });

  it('asks for a desktop update when the server no longer serves this one', () => {
    expect(checkCompatibility(serverInfo, '0.9.9')).toMatchObject({
      status: 'update-desktop',
    });
  });
});
