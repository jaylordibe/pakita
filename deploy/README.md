# Running a Pakita server

This folder runs a church's Pakita server on one machine with Docker
Compose. The server holds the church's songs, Bible translations, themes and
playlists; each laptop with the Pakita desktop app keeps its own copy and
presents without the internet.

What runs: Caddy (HTTPS), the Pakita API and its background worker,
PostgreSQL, Redis and S3-compatible file storage (RustFS). Only Caddy is
reachable from outside the machine; it forwards the storage bucket's path too,
so laptops upload and download background videos straight from storage with
links the API signed. The full runtime contract the containers
follow is in [`apps/api/docs/deployment/README.md`](../apps/api/docs/deployment/README.md).

## What you need

- **A Linux server** with Docker Engine and the Docker Compose plugin
  (`docker compose`), 2 GB of memory or more, and `openssl`.
- **A domain name** (for example `pakita.yourchurch.org`) whose DNS points at
  the server, with ports **80 and 443** open to the internet. Caddy obtains
  and renews the HTTPS certificate on its own.

No outside account is needed: Pakita sends no email or text and uses no
third-party service. Everything runs on this machine.

## Install

Another reverse proxy on this machine already holds ports 80 and 443?
Follow [`shared-server.md`](shared-server.md) instead.

1. Copy this folder to the server (or clone the repository there).
2. Run `./install.sh`. The first run creates `.env` from `.env.example`,
   generates the database, Redis, storage and sign-in secrets, and lists what
   is still missing.
3. Fill in `.env` (`PAKITA_VERSION` and `PAKITA_DOMAIN`), then run
   `./install.sh` again. It checks every value, downloads the release and
   starts the server.
4. Run `./create-admin.sh` to create the first administrator. It asks for an
   email and a password and stores neither anywhere else. The administrator
   runs the server and never belongs to a church, so use an email that is not
   someone's church account.
5. On a laptop, install the Pakita desktop app, connect to
   `https://your-domain` and sign in as the administrator. On the Server
   screen, create an account for your church's owner under **People**, then
   create the church under **Churches**, naming that owner.

## Files in Google Cloud Storage

On a Google Compute Engine VM, uploaded files can live in a Cloud Storage
bucket instead of on this machine. The server holds no key file: it uses the
VM's attached service account. That account needs three things, once, set
either with `gcloud` or in the Google Cloud console.

Its address (`<vm-sa>@<project>.iam.gserviceaccount.com`) is on the VM's
page: **Compute Engine → VM instances → your VM → API and identity
management → Service account**.

**1. Read, write and delete the bucket's objects.**

```bash
gcloud storage buckets add-iam-policy-binding gs://<bucket> \
  --member="serviceAccount:<vm-sa>@<project>.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
```

Console: **Cloud Storage → Buckets → your bucket → Permissions → Grant
access**. New principals: the service account's address. Role: **Storage
Object Admin**. Save.

**2. Sign upload and download links as itself.** Google signs them through
the IAM Credentials API, so the account may sign as itself and nothing else.

```bash
gcloud services enable iamcredentials.googleapis.com --project=<project-id>
gcloud iam service-accounts add-iam-policy-binding \
  <vm-sa>@<project>.iam.gserviceaccount.com \
  --member="serviceAccount:<vm-sa>@<project>.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator
```

Console:

- **APIs & Services → Library**, search **IAM Service Account Credentials
  API**, **Enable**.
- **IAM & Admin → Service Accounts → the VM's service account → Principals
  with access → Grant access**. New principals: the same service account's
  address. Role: **Service Account Token Creator**. Save. Grant it here, on
  the account, not on the project's IAM page: there it would let the account
  sign as every service account in the project.

**3. Reach the IAM API from the VM.** The VM's token reaches it only with the
`cloud-platform` access scope. A VM created with "Allow default access" lacks
it, and every upload then fails with "insufficient authentication scopes",
even with the roles above. Check on the VM:

```bash
curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/scopes
```

If `https://www.googleapis.com/auth/cloud-platform` is missing, change it
(Google's recommendation: the roles above, not the scope, limit what the
account may do). The VM must be stopped, which pauses everything it serves:

```bash
gcloud compute instances stop <vm> --zone=<zone>
gcloud compute instances set-service-account <vm> --zone=<zone> \
  --service-account=<vm-sa>@<project>.iam.gserviceaccount.com \
  --scopes=cloud-platform
gcloud compute instances start <vm> --zone=<zone>
```

Console: **Compute Engine → VM instances → your VM → Stop**, then **Edit →
Security and access → Access scopes → Allow full access to all Cloud APIs**.
Save, then **Start**.

Then set `PAKITA_STORAGE=gcs` and `PAKITA_GCS_BUCKET=<bucket>` in `.env`
and run `install.sh` (or `update.sh`). `backup.sh` then backs up the
database only: protect the bucket with its own soft delete or versioning.

## People and passwords

There is no sign-up. Accounts are created in the desktop app with a one-time
password, which the person must replace with their own the first time they
sign in: by the server's administrator (Server screen, **People**), or by a
church's owner or administrators for that church's own people (the church's
**People** tab), who then arrive already in it. Someone who already has an
account joins a church with an invitation code its owner or administrators
create and pass on; only that person's account can use it. Someone who forgets
their password asks the server's administrator, who sets a new one-time
password the same way; that also signs them out everywhere.

The server's administrator and other staff accounts never belong to a church.
A staff member who also serves in a church uses a second, ordinary account.
When a church's owner leaves or loses their account, the server's
administrator names a new owner (Server screen, **Churches**).

If the administrator cannot sign in themselves, reset their password on the
server:

```sh
./reset-password.sh
```

It asks for the account's email and a new password, stores neither anywhere
else, and signs that account out everywhere. The administrator chose this
password, so they are not asked to change it again.

Keep a copy of `.env` somewhere safe: it holds the server's secrets, and it is
not part of the backups.

## Update

```sh
./update.sh 0.1.1
```

It takes a backup, downloads the release, migrates the database and starts the
new version. Read the release notes first: a release may require newer desktop
apps, and says so.

## Back up and restore

```sh
./backup.sh                         # writes backups/<date-time>/
./restore.sh backups/<date-time>    # replaces the current data
```

A backup holds the database and the uploaded files (background videos
included, so it grows with them), with checksums; the API
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
They are not code-signed yet, so the first launch shows a warning:

- **macOS** says "Apple could not verify "Pakita" is free of malware". Click
  **Done** (not Move to Trash), then **System Settings → Privacy & Security**,
  scroll to the message about Pakita and click **Open Anyway**. Or, in
  Terminal: `xattr -dr com.apple.quarantine /Applications/Pakita.app`.
  Pakita then asks for the Mac's login password to use its keychain item,
  where it keeps the sign-in: enter it and choose **Always Allow**. Each new
  version asks once more.
- **Windows** SmartScreen says "Windows protected your PC": choose **More
  info → Run anyway**.

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
