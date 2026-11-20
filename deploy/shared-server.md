# Running Pakita on a machine with other services

`README.md` assumes Pakita has the machine to itself: its own Caddy takes
ports 80 and 443 and obtains the certificate. On a machine where another
reverse proxy already holds those ports (an nginx container serving other
sites, here called `webserver`), that proxy serves Pakita's domain instead,
and Pakita runs without Caddy. Everything else in `README.md` (updates,
backups, people and passwords) is unchanged.

What changes, and why:

- **Your nginx terminates HTTPS for Pakita's domain** and forwards to
  Pakita's API. Pakita publishes no port: its database, Redis and storage
  stay on its own networks, so they never clash with the machine's other
  databases.
- **Your nginx joins Pakita's private `edge` network at a fixed address**
  (`PAKITA_PROXY_ADDRESS`, `172.31.250.2` unless changed). The API believes
  the visitor address (`X-Forwarded-For`) from that address alone, which is
  what its per-address sign-in limits rely on. Trusting a network the other
  services share would let any of them forge visitor addresses.

## Releasing a version

Nothing is built on this machine: it downloads the images GitHub builds for
a release, so a release never slows the other services here, every server
runs a version someone chose, and going back is `./update.sh <old version>`.

To release, on your own computer:

1. Set the version (the first release is `0.1.0`; later ones `0.1.1`,
   `0.2.0`, …) in `package.json`,
   `apps/api/package.json` and `apps/desktop/package.json`, and commit it on
   `main`.
2. Tag that commit and push the tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

   `.github/workflows/publish-image.yml` tests it, then publishes
   `ghcr.io/jaylordibe/pakita:0.1.0` and `ghcr.io/jaylordibe/pakita-migrate:0.1.0`.
   It refuses a tag that is not on `main` or does not match the versions.
3. After the very first release, open both packages on GitHub (your profile
   → Packages) and check they are **public**. A server pulls without logging
   in, so a private package fails at `docker compose pull`.

## 1. Before you start

- A domain for Pakita (e.g. `pakita.yourchurch.org`) whose DNS points at
  this machine.
- Pakita's `edge` network uses `172.31.250.0/28`. Check that nothing on the
  machine uses it:

  ```sh
  docker network inspect $(docker network ls -q) \
    --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'
  ```

  If it is taken, choose another `/28` and set `PAKITA_EDGE_SUBNET`,
  `PAKITA_EDGE_DYNAMIC_RANGE` and `PAKITA_PROXY_ADDRESS` in `.env`
  together (see `.env.example`), and use that address in step 4.

## 2. Install Pakita without its Caddy

Pakita lives in `/srv/pakita`, apart from the other services' folders,
owned by the user that runs Docker. The clone only provides these scripts and
settings; the server itself comes from the release's images. Clone the
release you will run (the tag matching `PAKITA_VERSION`, e.g. `v0.1.1`), so
the scripts always match the server they manage:

```sh
sudo mkdir -p /srv/pakita
sudo chown "$USER": /srv/pakita
git clone --depth 1 --branch v0.1.1 https://github.com/jaylordibe/pakita.git /srv/pakita
cd /srv/pakita/deploy
cp shared-proxy/compose.override.yaml compose.override.yaml
cp .env.example .env    # install.sh also does this on its first run
```

Every command below runs in `/srv/pakita/deploy`. To update to a release
later, check out its tag there first, then run `./update.sh <version>`: it
takes a backup, downloads the new images, migrates the database and waits
until the API is healthy.

```sh
git -C /srv/pakita fetch --depth 1 origin tag v0.1.1
git -C /srv/pakita checkout v0.1.1
./update.sh 0.1.1
```

`compose.override.yaml` stops Caddy from starting and names the API
`pakita-api` (and storage `pakita-storage`) for your nginx. Docker Compose
reads it next to `compose.yaml` on its own, so every script here uses it.

In `.env`, set `PAKITA_DOMAIN`, `PAKITA_VERSION` and, for files in Google
Cloud Storage, `PAKITA_STORAGE=gcs` and `PAKITA_GCS_BUCKET` (`README.md`,
"Files in Google Cloud Storage"). Then:

```sh
./install.sh
```

It generates the secrets, starts Pakita and waits until the API is healthy.
It does not check ports 80 and 443 here: your nginx holds them.

## 3. A certificate for Pakita's domain

**Through Cloudflare's proxy** (the orange cloud), use **Full (strict)** for
Pakita's hostname, so the hop from Cloudflare to this machine is encrypted
too: Pakita carries sign-in passwords and session tokens. Cloudflare's
Flexible mode sends that hop in clear text, and would also loop, because
`pakita.conf` redirects plain HTTP to HTTPS. The setting applies to Pakita's
hostname alone; the domain's other sites keep theirs.

1. **SSL/TLS → Origin Server → Create Certificate**, for
   `pakita.yourdomain.com` only. Save the certificate and its private key on
   this machine where nginx reads certificates (the key readable by its
   owner only). It is free and lasts up to 15 years.
2. **Rules → Configuration Rules → Create rule**: when the hostname equals
   `pakita.yourdomain.com`, set **SSL** to **Full (strict)**.

**Without Cloudflare**, obtain a certificate the way this nginx's other
sites get theirs (certbot, …), so it renews with them.

## 4. Connect your nginx to Pakita

In your nginx's `docker-compose.yml`, give `webserver` Pakita's `edge`
network at the fixed address, and declare that network as external. A
service's networks must be written as a map to give one an address:

```yaml
services:
  webserver:
    # …as before…
    networks:
      cicd-network:
      taymna:
      pakita:
        ipv4_address: 172.31.250.2   # PAKITA_PROXY_ADDRESS

networks:
  # …as before…
  pakita:
    external: true
    name: pakita_edge
```

Copy `shared-proxy/pakita.conf` into the folder nginx reads sites from
(`conf/sites-available` here), replace `pakita.example.org`, and point its
two certificate lines at the certificate from step 3. With
`PAKITA_STORAGE=gcs`, delete its `location /pakita/` block: laptops then
reach the bucket directly.

Beside it, write Cloudflare's address ranges, which `pakita.conf` reads to
find each visitor's own address (`.inc`, not `.conf`: nginx loads every
`.conf` there for all sites, and only Pakita's should use this list). Run it
again now and then: Cloudflare announces changes to the list.

```sh
for range in $(curl -fsS https://www.cloudflare.com/ips-v4) \
             $(curl -fsS https://www.cloudflare.com/ips-v6); do
  echo "set_real_ip_from $range;"
done > conf/sites-available/cloudflare-ips.inc
```

Then recreate `webserver` (its other sites pause for the few seconds it
takes to restart), and check:

```sh
docker compose up -d webserver
docker compose exec webserver nginx -t
curl -fsS https://pakita.yourchurch.org/api/health/liveness
```

Then create the first administrator (`./create-admin.sh`, in
`/srv/pakita/deploy`) and connect the desktop app to `https://pakita.yourchurch.org`.

## Good to know

- **Order matters.** `pakita_edge` exists once Pakita is installed. Your
  nginx project cannot start while it is missing, so if you ever remove
  Pakita, remove the `pakita` network from `webserver` first.
- **Visitor addresses behind Cloudflare** are resolved by nginx
  (`cloudflare-ips.inc`), not by the API: leave the API's
  `TRUST_CLOUDFLARE_HEADERS` off. This machine also answers requests that do
  not come through Cloudflare, and the API would believe a forged
  `CF-Connecting-IP` from those.
- **nginx starts without Pakita.** `pakita.conf` looks the API up per
  request, so a stopped Pakita answers its own domain with 502 and never
  stops nginx from serving the other sites.
