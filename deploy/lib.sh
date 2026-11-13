#!/usr/bin/env bash
# Shared by the scripts in this folder. Not run on its own.
set -euo pipefail

DEPLOY_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIRECTORY"

fail() {
  echo "Error: $*" >&2
  exit 1
}

compose() {
  docker compose --project-directory "$DEPLOY_DIRECTORY" "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed (https://docs.docker.com/engine/install/)."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available ('docker compose')."
  docker info >/dev/null 2>&1 || fail "Docker is not running, or this user may not use it."
}

# The value of KEY in .env, or nothing.
env_value() {
  sed -n "s/^$1=//p" .env | tail -n 1
}

# Sets KEY=VALUE in .env, replacing an existing line.
set_env_value() {
  local key="$1" value="$2" temporary
  temporary="$(mktemp "$DEPLOY_DIRECTORY/.env.XXXXXX")"
  grep -v "^$key=" .env >"$temporary" || true
  printf '%s=%s\n' "$key" "$value" >>"$temporary"
  chmod 600 "$temporary"
  mv "$temporary" .env
}

# Waits until the API answers its health check (up to five minutes).
wait_until_healthy() {

  for _ in $(seq 1 60); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null)" = "healthy" ]; then
      return 0
    fi
    sleep 5
  done
  compose logs --tail 50 migrate api >&2 || true
  fail "the API did not become healthy; its last log lines are above."
}
