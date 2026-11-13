#!/usr/bin/env bash
# Updates the server to a release: ./update.sh 0.2.0
# A backup is taken first; the database is migrated before the new API starts.
source "$(dirname "$0")/lib.sh"

require_docker
[ -f .env ] || fail "no .env here: run install.sh first."
version="${1:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "usage: ./update.sh <version>, e.g. ./update.sh 0.2.0"

./backup.sh
previous="$(env_value PAKITA_VERSION)"
set_env_value PAKITA_VERSION "$version"
if ! compose pull; then
  set_env_value PAKITA_VERSION "$previous"
  fail "could not download release $version; still on $previous."
fi
compose up -d
wait_until_healthy
echo "Updated from $previous to $version."
