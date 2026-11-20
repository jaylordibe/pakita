#!/usr/bin/env bash
# Installs and starts the Pakita server. Safe to run again: it never replaces
# a secret that is already set.
source "$(dirname "$0")/lib.sh"

require_docker
command -v openssl >/dev/null 2>&1 || fail "openssl is needed to generate secrets."

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from .env.example."
fi

# Secrets: hex, so they never need escaping in a URL.
for key in DB_PASSWORD REDIS_PASSWORD STORAGE_SECRET_KEY; do
  [ -n "$(env_value "$key")" ] || set_env_value "$key" "$(openssl rand -hex 32)"
done
[ -n "$(env_value JWT_SECRET)" ] || set_env_value JWT_SECRET "$(openssl rand -hex 48)"

# Preflight: every value the server refuses to start without.
problems=()
domain="$(env_value PAKITA_DOMAIN)"
case "$domain" in
  "" | *example.org | localhost | *[!a-zA-Z0-9.-]*) problems+=("PAKITA_DOMAIN must be this server's public domain name") ;;
esac
[ -n "$(env_value PAKITA_VERSION)" ] || problems+=("PAKITA_VERSION is empty")
if [ "${#problems[@]}" -gt 0 ]; then
  echo "Fill in .env, then run install.sh again (README.md explains each value):" >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi

# Pakita's own Caddy serves the domain, unless another reverse proxy on this
# machine does instead (shared-server.md).
bundled_proxy=false
compose config --services | grep -qx caddy && bundled_proxy=true

# Ports 80 and 443, unless Pakita itself already holds them.
if [ "$bundled_proxy" = true ] && [ -z "$(compose ps -q caddy 2>/dev/null)" ]; then
  for port in 80 443; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      fail "port $port is already in use on this machine; Caddy needs it."
    fi
  done
fi

compose pull
compose up -d
wait_until_healthy
if [ "$bundled_proxy" = true ]; then
  echo "Pakita is running at https://$domain"
  echo "Run ./create-admin.sh to create the first administrator, then connect the desktop app to that address."
else
  echo "Pakita is running, but https://$domain answers only once your reverse proxy serves it:"
  echo "shared-server.md, steps 3 and 4. Then run ./create-admin.sh to create the first administrator."
fi
