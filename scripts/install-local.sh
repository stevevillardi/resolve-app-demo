#!/usr/bin/env bash
#
# Replaces /Applications/Switchboard.app with the freshly packaged build.
#
# The running copy is quit first, and deliberately with AppleScript rather than
# a kill: the app hides to the tray rather than exiting when its window closes,
# holds a SQLite handle, and may have a turn in flight -- `quit` lets it shut
# those down the way a user quitting it would. A kill is the fallback, not the
# opening move.
#
# `ditto` rather than `cp -R` because it preserves extended attributes and the
# code signature; a copy that arrives with a broken signature would lose the
# keychain identity the whole signing setup exists to keep stable, so the
# signature is verified after the copy rather than assumed.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME=Switchboard
SRC="dist/mac-arm64/${APP_NAME}.app"
DEST="/Applications/${APP_NAME}.app"

if [ "$(uname)" != "Darwin" ]; then
  echo "install-local: macOS only, skipping."
  exit 0
fi

if [ ! -d "$SRC" ]; then
  echo "install-local: $SRC is missing -- run \`npm run package\` first." >&2
  exit 1
fi

# --- Quit the running copy -------------------------------------------------
if pgrep -f "${DEST}/Contents/MacOS/${APP_NAME}" > /dev/null 2>&1; then
  echo "install-local: quitting the running ${APP_NAME}…"
  osascript -e "quit app \"${APP_NAME}\"" > /dev/null 2>&1 || true

  waited=0
  while pgrep -f "${DEST}/Contents/MacOS/${APP_NAME}" > /dev/null 2>&1 && [ "$waited" -lt 15 ]; do
    sleep 1
    waited=$((waited + 1))
  done

  if pgrep -f "${DEST}/Contents/MacOS/${APP_NAME}" > /dev/null 2>&1; then
    echo "install-local: it did not quit in ${waited}s, terminating."
    pkill -f "${DEST}/Contents/MacOS/${APP_NAME}" || true
    sleep 2
  fi
else
  echo "install-local: ${APP_NAME} is not running."
fi

# --- Install ---------------------------------------------------------------
# Removed rather than copied over: a stale file from the previous version that
# no longer exists in this one would otherwise survive inside the bundle and be
# sealed into nothing -- the signature covers what is there, not what is extra.
rm -rf "$DEST"
ditto "$SRC" "$DEST"

if ! codesign --verify --verbose=1 "$DEST" > /dev/null 2>&1; then
  echo "install-local: the installed copy fails signature verification." >&2
  echo "  Left in place for inspection: $DEST" >&2
  exit 1
fi

echo "install-local: installed $DEST"
codesign -d -r- "$DEST" 2>&1 | sed -n 's/^#* *designated =>/  designated =>/p'

# --- Relaunch --------------------------------------------------------------
# Skippable, because "build and install but do not steal my focus" is a real
# thing to want in the middle of something else.
if [ "${NO_LAUNCH:-}" = "1" ]; then
  echo "install-local: NO_LAUNCH=1, not relaunching."
else
  open "$DEST"
  echo "install-local: relaunched."
fi
