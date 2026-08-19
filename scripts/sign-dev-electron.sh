#!/usr/bin/env bash
#
# Gives the dev Electron the same code identity as the packaged app.
#
# `npm run dev`, `npm run demo`, `npm start` and Playwright all execute
# node_modules/electron/dist/Electron.app, which ships ad-hoc signed under the
# identifier "Electron". safeStorage seals credentials with a keychain key whose
# ACL trusts a code *designated requirement*: ad-hoc, that requirement is a hash
# of the binary, so every `npm ci` in every worktree was a new app to the
# keychain and the stored GitHub token read as locked.
#
# Signing with the Developer ID makes the requirement identifier + team, and
# forcing the identifier to the packaged app's means dev and packaged produce an
# identical requirement -- so one keychain grant covers both, and it survives
# rebuilds. Only the signature's identifier changes; Info.plist keeps
# CFBundleIdentifier com.github.Electron, and userData derives from
# app.getName(), so no profile moves.
#
# Runs from postinstall, because npm ci re-materializes the binary unsigned.
set -euo pipefail

cd "$(dirname "$0")/.."

APP=node_modules/electron/dist/Electron.app
# electron-builder.yml is the single source of truth for which certificate.
IDENTITY=$(sed -n 's/^  identity: \([0-9A-Fa-f]\{40\}\)$/\1/p' electron-builder.yml)
# Must match appId in electron-builder.yml -- that equality is the whole point.
IDENTIFIER=com.stevevillardi.switchboard

[ "$(uname)" = "Darwin" ] || exit 0

if [ ! -d "$APP" ]; then
  echo "sign-dev-electron: $APP not present, skipping."
  exit 0
fi

if [ -z "$IDENTITY" ]; then
  echo "sign-dev-electron: no signing identity in electron-builder.yml, skipping."
  exit 0
fi

# A clone on a machine without the certificate must still install. The app runs
# fine unsigned -- it just cannot share the keychain grant.
if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  echo "sign-dev-electron: certificate $IDENTITY not in this keychain, skipping."
  echo "  The dev app will keep its ad-hoc identity, so stored credentials will"
  echo "  read as locked after a rebuild. Import the cert and re-run npm ci."
  exit 0
fi

# Outer bundle only: the main process -- the one that talks to safeStorage -- is
# its executable, and nested ad-hoc helpers stay valid because dev is not under
# library validation. No --deep; Apple deprecates it for signing.
#
# Bounded, because the first use of a signing key raises a GUI dialog ("codesign
# wants to sign using key ... in your keychain") and this runs from npm ci: an
# unbounded wait wedges the install. A codesign killed mid-write leaves a
# .cstemp behind that gets sealed into the next signature, so the cleanup below
# is not optional -- it is repairing a real failure this script already caused.
codesign --force --sign "$IDENTITY" --identifier "$IDENTIFIER" "$APP" &
codesign_pid=$!
waited=0
while kill -0 "$codesign_pid" 2>/dev/null && [ "$waited" -lt 60 ]; do
  sleep 1
  waited=$((waited + 1))
done

if kill -0 "$codesign_pid" 2>/dev/null; then
  kill "$codesign_pid" 2>/dev/null || true
  wait "$codesign_pid" 2>/dev/null || true
  find "$APP" -name '*.cstemp' -delete
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "sign-dev-electron: codesign is waiting on a keychain dialog; left the app"
  echo "  ad-hoc signed so this install completes. Approve the prompt and re-run:"
  echo "    bash scripts/sign-dev-electron.sh"
  exit 0
fi

if ! wait "$codesign_pid"; then
  find "$APP" -name '*.cstemp' -delete
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "sign-dev-electron: codesign failed; left the app ad-hoc signed."
  exit 0
fi

echo "sign-dev-electron: signed $APP"
codesign -d -r- "$APP" 2>&1 | sed -n 's/^#* *designated =>/  designated =>/p'
