import { z } from 'zod';

import type { FetchFunction } from '../api/api-client';
import { compareVersions } from '../compatibility';

/** Published releases only; GitHub omits drafts from this endpoint. */
export const LATEST_RELEASE_URL =
  'https://api.github.com/repos/jaylordibe/pakita/releases/latest';
const RELEASE_PAGE_PREFIX = 'https://github.com/jaylordibe/pakita/releases/';
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

const releaseSchema = z.object({
  tag_name: z.string().regex(/^v\d+\.\d+\.\d+$/),
});

export interface AvailableUpdate {
  readonly version: string;
  /** The release's page, where the operator downloads the installer. */
  readonly url: string;
}

/** True only for one of this project's release pages: nothing else opens. */
export function isReleasePage(url: string): boolean {
  return /^https:\/\/github\.com\/jaylordibe\/pakita\/releases\/tag\/v\d+\.\d+\.\d+$/.test(
    url,
  );
}

/**
 * The newer published release, or null when this version is current or the
 * check could not be made (offline, rate-limited, unexpected answer). Pakita
 * never downloads or installs anything itself: a presenting laptop must not
 * change under the operator.
 */
export async function findUpdate(
  currentVersion: string,
  fetchFunction: FetchFunction,
): Promise<AvailableUpdate | null> {
  try {
    const response = await fetchFunction(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const release = releaseSchema.safeParse(await response.json());
    if (!release.success) return null;
    const version = release.data.tag_name.slice(1);
    // The page is built from the validated tag, never taken from the answer.
    return compareVersions(version, currentVersion) > 0
      ? { version, url: `${RELEASE_PAGE_PREFIX}tag/v${version}` }
      : null;
  } catch {
    return null;
  }
}
