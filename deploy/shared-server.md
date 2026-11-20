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

Put this folder in its own place on the machine (not inside the other
services' folders), then:

```sh
cp shared-proxy/compose.override.yaml compose.override.yaml
cp .env.example .env    # install.sh also does this on its first run
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

Obtain it the way your nginx's other sites get theirs (certbot, Cloudflare
origin certificate, …), so it renews with them.

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

Then recreate `webserver` (its other sites pause for the few seconds it
takes to restart), and check:

```sh
docker compose up -d webserver
docker compose exec webserver nginx -t
curl -fsS https://pakita.yourchurch.org/api/health/liveness
```

Then create the first administrator (`./create-admin.sh`, in Pakita's
folder) and connect the desktop app to `https://pakita.yourchurch.org`.

## Good to know

- **Order matters.** `pakita_edge` exists once Pakita is installed. Your
  nginx project cannot start while it is missing, so if you ever remove
  Pakita, remove the `pakita` network from `webserver` first.
- **If the domain goes through Cloudflare's proxy**, the visitor address
  reaches the API as Cloudflare's. Only if the origin is reachable through
  Cloudflare alone (`apps/api/docs/deployment/README.md`), add this under
  `api:` in `compose.override.yaml`, beside its `networks:`:

  ```yaml
      environment:
        TRUST_CLOUDFLARE_HEADERS: 'true'
  ```
- **nginx starts without Pakita.** `pakita.conf` looks the API up per
  request, so a stopped Pakita answers its own domain with 502 and never
  stops nginx from serving the other sites.
