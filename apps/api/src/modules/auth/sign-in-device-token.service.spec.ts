import { ConfigService } from '@nestjs/config';
import { SignInDeviceTokenService } from './sign-in-device-token.service';

const serviceWith = (secret: string) =>
  new SignInDeviceTokenService(new ConfigService({ jwt: { secret } }));

describe('SignInDeviceTokenService', () => {
  const service = serviceWith('a-jwt-secret-for-the-spec');

  it('recognises a token it issued for the same account', () => {
    const token = service.issue('user-1');
    expect(service.deviceIdFor('user-1', [token])).toEqual(expect.any(String));
  });

  it('gives each sign-in a different device', () => {
    const first = service.deviceIdFor('user-1', [service.issue('user-1')]);
    const second = service.deviceIdFor('user-1', [service.issue('user-1')]);
    expect(first).not.toBe(second);
  });

  it('ignores a token for another account, and finds the right one among several', () => {
    const others = service.issue('user-2');
    const own = service.issue('user-1');
    expect(service.deviceIdFor('user-1', [others])).toBeNull();
    expect(service.deviceIdFor('user-1', [others, own])).toBe(
      own.split('.')[1],
    );
  });

  it.each([
    ['a tampered device id', (token: string) => token.replace('.', '.x')],
    [
      'a token moved to another account',
      (token: string) => token.replace('user-1', 'user-2'),
    ],
    ['a truncated signature', (token: string) => token.slice(0, -2)],
    ['an extra segment', (token: string) => `${token}.extra`],
    ['garbage', () => 'not-a-token'],
  ])('refuses %s', (_label, alter) => {
    const altered = alter(service.issue('user-1'));
    expect(service.deviceIdFor('user-1', [altered])).toBeNull();
    expect(service.deviceIdFor('user-2', [altered])).toBeNull();
  });

  it('refuses a token signed under another secret', () => {
    const foreign = serviceWith('another-secret').issue('user-1');
    expect(service.deviceIdFor('user-1', [foreign])).toBeNull();
  });
});
