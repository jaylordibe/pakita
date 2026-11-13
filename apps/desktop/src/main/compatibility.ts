import type { components } from '../shared/api/openapi';
import type { Compatibility } from '../shared/ipc-contract';

/**
 * The API level this desktop build was written against (the server's
 * `API_LEVEL`, apps/api/src/modules/public/desktop-compatibility.ts). A server
 * at this level or above serves it.
 */
export const REQUIRED_API_LEVEL = 5;

/** Compares `major.minor.patch` versions; a pre-release suffix is ignored. */
export function compareVersions(first: string, second: string): number {
  const parse = (version: string) =>
    version
      .split('-')[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const firstParts = parse(first);
  const secondParts = parse(second);
  for (let index = 0; index < 3; index += 1) {
    const difference = (firstParts[index] ?? 0) - (secondParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

/** Which side, if either, must be updated before the two can work together. */
export function checkCompatibility(
  serverInfo: components['schemas']['ServerInfoResponseDto'],
  desktopVersion: string,
): Compatibility {
  if (serverInfo.apiLevel < REQUIRED_API_LEVEL) {
    return {
      status: 'update-server',
      message: `This Pakita needs a newer church server (server ${serverInfo.serverVersion}). Ask your administrator to update it.`,
    };
  }
  if (compareVersions(desktopVersion, serverInfo.minimumDesktopVersion) < 0) {
    return {
      status: 'update-desktop',
      message: `Your church server needs Pakita ${serverInfo.minimumDesktopVersion} or later. Update this app.`,
    };
  }
  return { status: 'compatible', message: null };
}
