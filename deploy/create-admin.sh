#!/usr/bin/env bash
# Creates the server's first administrator (or gives an existing account the
# administrator role, unless it belongs to a church: staff never do). Asks for
# the email and password; neither is stored or printed. Run once after
# install.sh.
source "$(dirname "$0")/lib.sh"

require_docker
[ -n "$(compose ps -q postgres 2>/dev/null)" ] || fail "the server is not running: run install.sh first."

read -r -p "Administrator's email: " email
read -r -s -p "Password: " password
echo
read -r -s -p "Password again: " confirmation
echo
[ "$password" = "$confirmation" ] || fail "the passwords differ."

# Passed by name only, so neither value appears in a process listing.
SEED_ADMIN_EMAIL="$email" SEED_ADMIN_PASSWORD="$password" \
  compose run --rm --no-deps -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD \
  migrate pnpm prisma:seed
echo "Done. Sign in with that email in the desktop app; on the Server screen, create your church's owner under People, then the church under Churches."
