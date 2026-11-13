const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type ServerAddressResult =
  | { readonly isValid: true; readonly origin: string }
  | { readonly isValid: false; readonly reason: string };

/**
 * Turns what an operator typed ("pakita.mychurch.org", a full URL) into the
 * server's origin. HTTPS is required — the connection carries passwords and
 * tokens — except for a server on this computer.
 */
export function parseServerAddress(input: string): ServerAddressResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { isValid: false, reason: 'Enter your church server’s address.' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { isValid: false, reason: 'That is not a valid address.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { isValid: false, reason: 'The address must start with https://.' };
  }
  if (url.username || url.password) {
    return {
      isValid: false,
      reason: 'The address must not contain a user name or password.',
    };
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    return {
      isValid: false,
      reason:
        'The server must use https:// (only a server on this computer may use http://).',
    };
  }
  return { isValid: true, origin: url.origin };
}
