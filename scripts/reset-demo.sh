#!/usr/bin/env bash
#
# Resets the demo environment back to runbook-ready (docs/demo-runbook.md).
#
# Two halves, both idempotent:
#   repo    — close every open PR on the demo repo and delete its branch,
#             delete any other leftover non-default remote branches, and
#             reopen any closed issues (the planted demo material).
#   profile — with the app QUIT: delete the local clone and the profile's
#             database/worktrees/demo dirs. Credentials are deliberately
#             kept — secrets/ on disk plus the Claude/Codex logins — so the
#             next launch starts at onboarding with all three rows green.
#
# Usage:
#   npm run demo:reset                # both halves
#   npm run demo:reset -- --repo-only     # keep the app profile
#   npm run demo:reset -- --profile-only  # keep the GitHub state
#   npm run demo:reset -- --dry-run       # say what would happen
#
# Defaults match the seeded demo repo; override with env vars:
#   DEMO_REPO=owner/name DEMO_CLONE=/path/to/clone npm run demo:reset

set -euo pipefail

DEMO_REPO="${DEMO_REPO:-stevevillardi/switchboard-journey-demo}"
DEMO_CLONE="${DEMO_CLONE:-$HOME/Documents/GitHub/SwitchboardRepos/${DEMO_REPO##*/}}"
PROFILE="$HOME/Library/Application Support/switchboard"

do_repo=true
do_profile=true
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --repo-only) do_profile=false ;;
    --profile-only) do_repo=false ;;
    --dry-run) dry_run=true ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

run() {
  if $dry_run; then echo "  would: $*"; else "$@"; fi
}

if $do_profile; then
  # Two writers on one SQLite database is the corruption this refuses to risk.
  if pgrep -f "user-data-dir=.*Application Support/switchboard" > /dev/null 2>&1; then
    echo "Switchboard is running — quit it first (Cmd-Q or Ctrl-C the npm run dev terminal)." >&2
    exit 1
  fi
fi

if $do_repo; then
  echo "— GitHub: $DEMO_REPO"
  default_branch=$(gh api "repos/$DEMO_REPO" --jq .default_branch)

  gh pr list -R "$DEMO_REPO" --state open --json number --jq '.[].number' |
    while read -r pr; do
      echo "  closing PR #$pr (and deleting its branch)"
      run gh pr close "$pr" -R "$DEMO_REPO" --delete-branch
    done

  # Branches a run left behind without an open PR (a closed PR keeps its
  # branch unless --delete-branch ran at close time).
  gh api "repos/$DEMO_REPO/branches" --jq '.[].name' |
    while read -r branch; do
      [ "$branch" = "$default_branch" ] && continue
      echo "  deleting leftover branch $branch"
      run gh api -X DELETE "repos/$DEMO_REPO/git/refs/heads/$branch"
    done

  # The issues ARE the demo material — Journey 3 needs at least one open.
  gh issue list -R "$DEMO_REPO" --state closed --json number --jq '.[].number' |
    while read -r issue; do
      echo "  reopening issue #$issue"
      run gh issue reopen "$issue" -R "$DEMO_REPO"
    done
fi

if $do_profile; then
  echo "— Local"
  if [ -d "$DEMO_CLONE" ]; then
    echo "  deleting clone $DEMO_CLONE"
    run rm -rf "$DEMO_CLONE"
  fi
  # The database and everything derived from it; secrets/ stays untouched so
  # GitHub/API credentials survive the reset.
  for target in "$PROFILE/switchboard.db" "$PROFILE/switchboard.db-wal" "$PROFILE/switchboard.db-shm"; do
    [ -f "$target" ] && { echo "  deleting ${target##*/}"; run rm -f "$target"; }
  done
  for target in "$PROFILE/worktrees" "$PROFILE/demo"; do
    [ -d "$target" ] && { echo "  deleting ${target##*/}/"; run rm -rf "$target"; }
  done
fi

$dry_run && echo "(dry run — nothing was changed)"
echo "Done. Next launch starts at onboarding, credentials intact."
