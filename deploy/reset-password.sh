#!/usr/bin/env bash
# Sets a new password for an account, from the server itself — the way back in
# when nobody who can reset passwords in the app can sign in (usually the
# administrator's own account). Ends every session the account holds. Asks for
# the email and the new password; neither is stored or printed.
source "$(dirname "$0")/lib.sh"

require_docker
[ -n "$(compose ps -q postgres 2>/dev/null)" ] || fail "the server is not running: run install.sh first."

read -r -p "Account's email: " email
read -r -s -p "New password: " password
echo
read -r -s -p "New password again: " confirmation
echo
[ "$password" = "$confirmation" ] || fail "the passwords differ."

# Passed by name only, so neither value appears in a process listing.
RESET_EMAIL="$email" RESET_PASSWORD="$password" \
  compose run --rm --no-deps -e RESET_EMAIL -e RESET_PASSWORD \
  migrate pnpm account:reset-password
echo "Done. Sign in with the new password in the desktop app."
