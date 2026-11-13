# Running a Pakita server

This folder runs a church's Pakita server on one machine with Docker
Compose. The server holds the church's songs, Bible translations, themes and
playlists; each laptop with the Pakita desktop app keeps its own copy and
presents without the internet.

What runs: Caddy (HTTPS), the Pakita API and its background worker,
PostgreSQL, Redis and S3-compatible file storage (RustFS). Only Caddy is
reachable from outside the machine. The full runtime contract the containers
follow is in [`apps/api/docs/deployment/README.md`](../apps/api/docs/deployment/README.md).

## What you need

- **A Linux server** with Docker Engine and the Docker Compose plugin
  (`docker compose`), 2 GB of memory or more, and `openssl`.
- **A domain name** (for example `pakita.yourchurch.org`) whose DNS points at
  the server, with ports **80 and 443** open to the internet. Caddy obtains
  and renews the HTTPS certificate on its own.
- **Three outside accounts.** The server will not start without them:

| Service | Used for | What to put in `.env` |
|---|---|---|
| [Resend](https://resend.com) or [Mailgun](https://www.mailgun.com) | Sign-up verification and password-reset emails | `EMAIL_PROVIDER` (`resend` or `mailgun`), its API key (and for Mailgun, `MAILGUN_DOMAIN` and `MAILGUN_REGION`), and `EMAIL_FROM`, a sender on a domain you have verified with that service |
| [Twilio](https://www.twilio.com) | Phone-number verification texts | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (a Twilio number) |
| [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) | The bot check at sign-up and sign-in | Two widgets, both with your domain in their hostname list: one for the website (`TURNSTILE_WEB_SITE_KEY`, `TURNSTILE_WEB_SECRET`) and one for the app (`TURNSTILE_MOBILE_SITE_KEY`, `TURNSTILE_MOBILE_SECRET`) — the desktop app signs in through the app widget |

## Install

1. Copy this folder to the server (or clone the repository there).
2. Run `./install.sh`. The first run creates `.env` from `.env.example`,
   generates the database, Redis, storage and sign-in secrets, and lists what
   is still missing.
3. Fill in `.env` (`PAKITA_VERSION`, `PAKITA_DOMAIN` and the three accounts
   above), then run `./install.sh` again. It checks every value, downloads the
   release and starts the server.
4. Run `./create-admin.sh` to create the first administrator. It asks for an
   email and a password and stores neither anywhere else.
5. On a laptop, install the Pakita desktop app, connect to
   `https://your-domain`, sign in as the administrator and create your church.

Keep a copy of `.env` somewhere safe: it holds the server's secrets, and it is
not part of the backups.

## Update

```sh
./update.sh 0.2.0
```

It takes a backup, downloads the release, migrates the database and starts the
new version. Read the release notes first: a release may require newer desktop
apps, and says so.

## Back up and restore

```sh
./backup.sh                         # writes backups/<date-time>/
./restore.sh backups/<date-time>    # replaces the current data
```

A backup holds the database and the uploaded files, with checksums; the API
pauses for the moments it takes (laptops keep presenting: they work offline).
Copy the `backups` folder off the server regularly (to another machine or to
cloud storage), and test a restore now and then.

A restore first checks the backup and saves the current data as a new backup.
Afterwards everyone signs in again, passwords are as they were when the
backup was taken, and every laptop downloads its church's content again on
its next synchronisation (keeping its current copy until that completes).

## Desktop installers

Download them from the project's
[releases page](https://github.com/jaylordibe/pakita/releases) only. Each
release lists SHA-256 checksums (`SHA256SUMS`) and carries a build provenance
attestation (`gh attestation verify <installer> --repo jaylordibe/pakita`).
They are not code-signed yet, so the first launch shows a warning: on macOS,
right-click the app and choose **Open**; on Windows, choose **More info → Run
anyway**.
The app tells the operator when a newer release is available; it never
updates itself during a service.

## Troubleshooting

- **The API does not become healthy:** `docker compose logs migrate api`.
  A missing or malformed setting is named in the first lines.
- **No certificate:** check that the domain's DNS points at this server and
  that ports 80 and 443 reach it: `docker compose logs caddy`.
- **The address range is in use:** set `PAKITA_EDGE_SUBNET`,
  `PAKITA_EDGE_DYNAMIC_RANGE` and `PAKITA_PROXY_ADDRESS` in `.env` (see
  `.env.example`).
