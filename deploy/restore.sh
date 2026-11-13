#!/usr/bin/env bash
# Restores a backup made by backup.sh: ./restore.sh backups/<date-time>
# REPLACES the current database and uploaded files. The backup is checked
# first, and the current data is backed up before anything is replaced.
source "$(dirname "$0")/lib.sh"

require_docker
source_directory="${1:-}"
[ -f "$source_directory/SHA256SUMS" ] || fail "usage: ./restore.sh backups/<date-time> (no SHA256SUMS there)"

# 1. The backup is whole and readable — before touching anything.
(cd "$source_directory" && sha256sum --check --quiet SHA256SUMS) ||
  fail "$source_directory does not match its checksums; it is damaged or incomplete."
gzip -t "$source_directory/storage.tar.gz" || fail "storage.tar.gz is unreadable."
compose exec -T postgres pg_restore --list <"$source_directory/database.dump" >/dev/null ||
  fail "database.dump is unreadable."

if [ "${2:-}" != "--yes" ]; then
  echo "This replaces the current database and files with $source_directory."
  read -r -p "Type RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || fail "cancelled."
fi

# 2. A safety copy of what is there now.
./backup.sh

# 3. Replace.
compose stop caddy api worker
compose exec -T postgres dropdb -U pakita --if-exists --force pakita
compose exec -T postgres createdb -U pakita pakita
compose exec -T postgres pg_restore -U pakita --dbname=pakita --no-owner <"$source_directory/database.dump"

compose stop storage
docker run --rm -i -v pakita_storage-data:/data postgres:18.3 \
  sh -c 'find /data -mindepth 1 -delete && tar -xzf - -C /data' <"$source_directory/storage.tar.gz"

# 4. Laptops hold copies newer than this backup: a new sync epoch makes each
# download its church's content again (keeping its copy until done). And no
# session from before the restore survives it: sign-ins revoked after the
# backup was taken must not come back.
compose exec -T postgres psql -U pakita -d pakita -v ON_ERROR_STOP=1 \
  -c 'UPDATE workspace_sync_states SET epoch = gen_random_uuid();' \
  -c 'UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;'

compose up -d
wait_until_healthy
echo "Restored $source_directory. Everyone signs in again; passwords are as they were when the backup was taken."
