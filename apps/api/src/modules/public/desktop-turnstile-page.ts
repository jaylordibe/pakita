import { randomBytes } from 'node:crypto';
import type { Response } from 'express';

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * Where the challenge page sends the solved token: the desktop app watches
 * for a navigation to this path, reads the token from the URL fragment and
 * cancels the navigation. A fragment is never sent to a server, so the token
 * appears in no request and no log.
 */
export const DESKTOP_TURNSTILE_DONE_PATH = '/api/public/desktop-turnstile/done';

const escapeAttribute = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );

const PAGE_STYLE = `body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#222}
main{text-align:center;max-width:24rem;padding:1rem}p{color:#555}`;

/**
 * The page Pakita's desktop app shows before a password sign-in: the app
 * widget, and nothing else. Same headers as the API's other credential page
 * (OAuthPagesService): a per-response nonce, nothing loads but Turnstile, it
 * can never be framed, and it is never cached.
 */
export function sendDesktopTurnstilePage(
  response: Response,
  siteKey: string,
): void {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pakita — sign-in check</title>
<style nonce="${nonce}">${PAGE_STYLE}</style>
<script nonce="${nonce}">
function pakitaTurnstileSolved(token) {
  window.location.replace(${JSON.stringify(DESKTOP_TURNSTILE_DONE_PATH)} + '#token=' + encodeURIComponent(token));
}
</script>
<script nonce="${nonce}" src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js" async defer></script>
</head>
<body>
<main>
<h1>One moment</h1>
<p>Pakita is checking this sign-in is from a person.</p>
<div class="cf-turnstile" data-sitekey="${escapeAttribute(siteKey)}" data-callback="pakitaTurnstileSolved"></div>
</main>
</body>
</html>`;
  response
    .status(200)
    .setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        `style-src 'nonce-${nonce}'`,
        `script-src 'nonce-${nonce}' ${TURNSTILE_ORIGIN}`,
        `frame-src ${TURNSTILE_ORIGIN}`,
        `connect-src ${TURNSTILE_ORIGIN}`,
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join('; '),
    )
    .setHeader('X-Frame-Options', 'DENY')
    .setHeader('Cache-Control', 'no-store')
    .setHeader('Referrer-Policy', 'no-referrer')
    .type('html')
    .send(html);
}
