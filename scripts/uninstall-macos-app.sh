#!/usr/bin/env bash
# Remove the Untype wrapper .app installed by install-macos-app.sh.
set -euo pipefail

APP_NAME="Untype"
APPS_DIR="${UNTYPE_APPS_DIR:-/Applications}"
APP_PATH="$APPS_DIR/$APP_NAME.app"

log()  { printf '\033[1;34m[uninstall-macos-app]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[uninstall-macos-app]\033[0m %s\n' "$*" >&2; exit 1; }

if [ ! -e "$APP_PATH" ]; then
  log "Nothing to remove — $APP_PATH does not exist."
  exit 0
fi

if [ ! -w "$APPS_DIR" ]; then
  fail "Cannot write to $APPS_DIR. Re-run with sudo, or set UNTYPE_APPS_DIR."
fi

rm -rf "$APP_PATH"
log "Removed $APP_PATH"
