#!/usr/bin/env bash
# Backs up the database and uploaded files to backups/<date-time>/, with
# checksums. The API and worker pause for the few moments it takes, so the
# database and the files match (laptops keep presenting meanwhile: they work
# offline). Copy the folder off this machine. .env (the secrets) is not
# included: keep your own copy of it somewhere safe.
source "$(dirname "$0")/lib.sh"
umask 077

require_docker
[ -n "$(compose ps -q postgres 2>/dev/null)" ] || fail "the database is not running."

target="backups/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$target"

resume() { compose start api worker >/dev/null 2>&1 || true; }
trap resume EXIT
compose stop api worker >/dev/null

compose exec -T postgres pg_dump -U pakita --format=custom pakita >"$target/database.dump"
# The storage volume, read through an image already on this machine.
docker run --rm -v pakita_storage-data:/data:ro postgres:18.3 \
  tar -czf - -C /data . >"$target/storage.tar.gz"
env_value PAKITA_VERSION >"$target/version"
(cd "$target" && sha256sum database.dump storage.tar.gz version >SHA256SUMS)

echo "Backup written to $DEPLOY_DIRECTORY/$target"
