---
name: auth-security
description: This repository's answers for authentication and account security — the JWT and session contract, administrator-created accounts and the forced first password change, administrator password resets, the per-account failed sign-in limit, and throttling on public authentication routes.
when_to_use: Use when changing src/modules/auth, JWT strategy or session validation, account creation, login/logout, password changes or resets, the password-change-required restriction, login throttling or the failed sign-in limit, credential checks, authentication errors, or public authentication endpoints.
user-invocable: false
---

# Authentication security — this repository's answers

The `himoa:domain-auth` skill carries the questions and failure modes of any
authentication change. This file carries **only this repository's answers**.
Cross-cutting rules these flows also obey — the `Errors.*` factory, response
DTOs and `@Exclude()` + `@ApiHideProperty()`, `AuditService` and the request
envelope, config access, log redaction, datetime decorators, the global
throttle — are in `AGENTS.md`, with their mechanics in
`docs/engineering-conventions.md`. They are not repeated here.

Read first: `src/modules/auth/**`, `src/common/errors/README.md`, and the
existing auth e2e specs. Source is authoritative; do not invent a token,
session or account design the implementation already defines.

Permissions, roles, scope, ownership and 403-versus-404 belong to the
`authorization` skill.

## No outside services

Pakita sends no email or text and runs no bot check, so nothing can prove that
someone controls an address or a number. There is therefore no public sign-up,
no email or phone verification, no emailed reset link and no one-time code.
Do not add one: a design that needs to prove an address needs an outside
service, which a self-hosted church server does not have.

## JWT and session authority

- Claims are `sub`, `jti` and the registered `iat`/`exp`/`iss`/`aud` only — no
  roles, permissions, membership or ownership in the token. `iat` is pinned to
  the session's issue instant; the `passwordChangedAt` cutoff compares against
  it. Grants are re-read per request (`src/common/authorization/README.md`,
  Caching and invalidation).
- Preserve the `jti` session/revocation contract. Issuer and audience derive
  from `SERVICE_NAME`; the JWT strategy validates issuer, audience, signature,
  expiry and session state, and refuses any token carrying a `purpose` claim.
- Identity reads use `prisma.scoped`, so soft-deleted accounts cannot
  authenticate. Deletion and suspension are independent states — never one
  boolean.
- Ending sessions = move the cutoff (`passwordChangedAt`) and revoke refresh
  families, always together (`RefreshTokenService.endAllSessions*`). A
  self-service password or email change then starts a fresh session for the
  caller (`startSession`) and returns it, like Laravel's `logoutOtherDevices`.
  `waitForSessionCutoff` is correctness, not padding: the cutoff is rounded up
  to the next whole second, and a token minted inside that second would be
  dead on arrival.

## Accounts and passwords

- An administrator creates every account (`POST /users`, `create User`). The
  administrator chooses the first password, so the account is created with
  `isPasswordChangeRequired = true`.
- An administrator resets a lost password with `PATCH /users/:id/password`
  (`resetPassword User`, never on themselves): every session the account holds
  ends and `isPasswordChangeRequired` is set again, so the administrator does
  not keep knowing a working password.
- While `isPasswordChangeRequired` is true, `JwtAuthGuard` refuses every
  authenticated route with 403 `PASSWORD_CHANGE_REQUIRED` except those marked
  `@AllowedWhilePasswordChangeRequired()`: `PATCH /users/me/password`,
  `GET /users/me`, `POST /auth/logout`, `POST /auth/logout-all`. Keep that list
  that short. Only the person's own `PATCH /users/me/password` clears the flag.
  The refusal is a 403, not a 401, so a client keeps its tokens.
- The MCP OAuth sign-in refuses such an account (`isAccountUsable`): MCP has no
  change-password step.
- The server owner recovers their own account on the server with
  `deploy/reset-password.sh`; they chose that password, so it does not set the
  flag.
- A password being checked takes `@IsCheckedPassword()` (8 characters to 72
  bytes), one being set `@IsAccountPassword()`.

## Login

- Login failures (unknown identifier, wrong password, inactive account) are
  `INVALID_CREDENTIALS`. An unknown identifier still runs a dummy bcrypt
  compare, as Laravel and Django do. No timing padding beyond that.
- Every password sign-in goes through `AuthService.verifyCredentials` (the REST
  login and the MCP OAuth sign-in page).
- Never return raw database, bcrypt or JWT errors.

## Throttling and the failed sign-in limit

The global throttle is **not sufficient** for these. Every password sign-in
form carries `@ThrottleSignIn()`: 5/min per lower-cased identifier + IP
(`loginThrottleTracker`) and 30/min per IP across identifiers
(`signInAddressThrottler`), one budget shared by both forms.

Neither key sees one account guessed at from many addresses, so
`SignInFailureLimitService` counts password checks per ACCOUNT from every
address. Each check is reserved (one atomic Redis transaction) BEFORE the
password is compared, so concurrent guesses cannot all slip under the limit:
after `MAX_FAILED_SIGN_INS` (10) checks within `FAILED_SIGN_IN_WINDOW_SECONDS`
(15 minutes, from the first) without a success, every further check — right
password or wrong — answers 429 `RATE_LIMITED` until the window ends. An
account's email and username share one budget; an identifier that names no
account is counted under itself, so the two cases look the same. A correct
password, an administrator's reset and the owner's `reset-password.sh` clear
the count. A Redis failure fails closed.

It is never a lockout, because of OWASP's device cookies
(`SignInDeviceTokenService`): a successful `POST /auth/login` returns a signed
`deviceToken` (account id, random device id, HMAC with a key derived from
`JWT_SECRET`); a client sends the tokens it holds in `deviceTokens`, and one
valid for the account moves that device's checks to its own count
(`deviceSignInSubject`), which strangers' failures never reach and which is
limited the same way. A token alone grants nothing — the password is still
checked — so it is stateless and not revocable; rotating `JWT_SECRET` voids
them all. The MCP OAuth sign-in page presents none.

Every other public route carries its own `@Throttle({ default: { limit, ttl }
})` (`refresh`: 10/min). So does every route that checks `currentPassword`
(`/users/me/password`, `/users/me/email`, `/users/me/gdpr-erase`, 5/min — a
stolen access token must not become a password oracle) or hashes one for an
administrator (`POST /users`, `PATCH /users/:id/password`, 20/min). E2e runs
skip the route throttles (not the failed sign-in limit), so a new route limit
is pinned in a controller spec (`users-controller-throttle.spec.ts`).

Whose budget a request spends is `UserAwareThrottlerGuard`'s decision: a valid
access token spends its user's, everything else the client IP's. Every
`@Public()` route spends the IP's **even when a token is sent** — otherwise one
address holding N accounts would multiply each public limit above by N. The
authenticated limits above (`currentPassword` routes) are per user, so N
accounts on one address do get N budgets there. The IP is `request.ip`, so it
is only as honest as `TRUST_PROXY` (see "Client topologies" in
`docs/deployment/README.md`).

## Required tests when relevant

Use the `e2e-testing` skill for the harness.

- valid and invalid credentials;
- missing account and wrong password return the same public contract;
- the dummy-password path remains reachable;
- the failed sign-in limit: reached from many addresses and by concurrent
  guesses, shared by email and username, the same for an unknown identifier,
  cleared by a correct password and by a reset; a known device's token lets it
  through on its own count, and a token for another account does not;
- an administrator-created or reset account: refused everywhere but the allowed
  routes with `PASSWORD_CHANGE_REQUIRED`, released by its own password change;
- suspended and soft-deleted account behavior;
- session revocation on every credential change (other sessions only, for
  self-service changes);
- public-route throttling;
- stable `errorCode` and response DTO serialization;
- audit event and redaction behavior.
