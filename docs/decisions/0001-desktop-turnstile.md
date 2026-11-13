# 0001 — Desktop sign-in and the Turnstile bot check

- **Status:** accepted (2026-11-13). The flow is proven end to end in Phase 2
  with Cloudflare's test keys; the hostname check against a real widget is
  proven by the first church deployment (see "What is not yet proven").
- **Context:** Pakita adopts the API template unchanged, and in staging and
  production the template requires a Cloudflare Turnstile token on every
  password sign-in (`apps/api/src/common/turnstile/turnstile.guard.ts`). The
  desktop app must therefore obtain a token before it can sign in.

## What the template already does

- `TurnstileGuard` reads the token from the `X-Turnstile-Token` header, and
  picks the widget by the `Origin` header: present → `web` widget, absent →
  `mobile` widget. A request from the desktop app's main process carries no
  `Origin`, so it is verified against `TURNSTILE_MOBILE_SECRET`.
- With both secrets unset (allowed in development and test only), the guard
  passes every request.

## What Cloudflare documents

- Turnstile does not run natively; a native app shows the widget inside an
  embedded browser view that loads a web page containing it
  ([Mobile implementation](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)).
- A widget only runs on the hostnames listed for it; a listed domain covers
  its subdomains ([Hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)).
- The test site keys (`1x00000000000000000000AA`, always passes) work on any
  hostname, and the test secret `1x0000000000000000000000000000000AA` accepts
  only their dummy token
  ([Testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)).

## Decision

1. The API serves one small public page that renders the **mobile** widget,
   with its site key from a new optional setting, `TURNSTILE_MOBILE_SITE_KEY`.
   This is additive: no template behaviour or check changes.
2. The desktop app opens that page from the church's own server in a
   dedicated window: sandboxed, no preload, its own session, and allowed to
   navigate only to the server's origin and `challenges.cloudflare.com`.
3. When the widget succeeds, the page hands the token back by navigating to
   a reserved URL that the main process intercepts (and cancels), then
   closes the window. The token never reaches the operator window.
4. The main process sends `POST /api/auth/login` with `X-Turnstile-Token` and
   no `Origin`, so the template's guard verifies it with the mobile secret.
5. A church admin lists the **API's domain** on the mobile widget. The
   deployment guide says so.

**Why this way:** it is Cloudflare's documented pattern for apps, the page is
hosted on a domain the church controls (so the hostname list works), and the
template's guard needs no change.

**Rejected:**
- *Loading the widget inside the operator window* — the widget would need the
  `app://` origin on its hostname list, which Cloudflare's hostname field
  cannot express, and the operator window's CSP would have to admit a
  third-party script.
- *Making Turnstile optional for desktop sign-ins* — weakens a template
  security control; ruled out on 2026-11-13.

## What is not yet proven

Whether a production (non-test) mobile widget accepts the token from a page
on the church's API domain inside Electron. Cloudflare documents the pattern
for embedded browser views, and Electron's window is Chromium, so this is
expected to work. If a deployment shows otherwise, revisit this record.
