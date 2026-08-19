# Phase 18 — Switchboard

**Status: Done**
**Branch:** `phase-18-switchboard`, 7 commits after the phase-17 merge.

## The token mystery (write this down; it will be asked again)

"Why does my GitHub token keep getting invalidated? Are we not refreshing it?"

It was never GitHub and never expiry. The configured client is an **OAuth
App** (`Ov…` id), whose device-flow tokens do not expire on a timer, and
refresh grants require a `client_secret` a desktop app has nowhere safe to
hold — which is why the blueprint chose device flow. The bug was local:
`getSecret()` **deleted any secret it failed to decrypt**, and on macOS
`safeStorage` binds ciphertext to the app's code signature. Every phase
worktree's `npm ci` produces a freshly ad-hoc-signed dev Electron, so
switching worktrees made the Keychain refuse the previous build's ciphertext —
and the app answered by erasing the credential. A recoverable identity
mismatch, converted into a permanent loss, wearing GitHub's fault.

The fix is to not destroy: decrypt failure now keeps the file (the build that
wrote it can still read it — switching back genuinely recovers), records the
key as unreadable for this process, and the status surfaces say what
happened.

> **Superseded, 2026-08-19.** The above made the symptom survivable; the cause
> is now gone. `mac.identity` is a real Developer ID and `postinstall` re-signs
> the dev Electron under the same identifier, so the designated requirement is
> identifier + team rather than a hash of the binary — a rebuild, a new
> worktree and an Electron upgrade all keep the keychain grant. The `locked`
> state below still exists and is still correct; it is now reached only by a
> genuinely foreign identity (a copied profile, an unsigned build on a machine
> without the certificate), not by every `npm ci`. GitHub gets a `locked` tokenState — attention dot, its own dialog
and Home-banner copy, Reconnect offered — worded to blame the binary, never
the credential. A stored Anthropic/OpenAI key in the same state says so
through the per-backend error field. And because the _other_ road to this
symptom is a GitHub App id silently issuing 8-hour tokens whose refresh
fields the device flow drops twice, `clientId()` now warns on an `Iv…`
prefix and `.env.example` explains why.

Also humanized on the way: probe failures report a sentence, not a stderr
dump — warning noise skipped, first substantive line, full text to the
console.

## The rest

- **Seed content rewrite** — all 10 skills got real bodies (rules with the
  why, worked examples, explicit non-goals) and all 8 personas got full
  prompts (role, method, output contract, boundaries restating the sandbox in
  prose). Ids, names, colors, tiers, scopes unchanged; test pins hold.
  `SEED_VERSION` stays `'1'`: existing profiles keep their copies by design —
  the reset below is how a dev profile sees the new content, and the starter
  library offers it to anyone who deleted theirs.
- **Dev reset** — Settings gains a Developer section (dev builds only;
  `appInfo.get` now carries the flag) with one Reset button. `clearAppData()`
  deletes contacts first through the real `deleteContact` path (that ordering
  is what leaves real repos' `.git/worktrees` registries clean), force-deletes
  each `persona/*` branch (pre-release, reset means zero trace), then drops
  the db **with its WAL siblings** after `closeDb()` (new — unlinking an open
  db leaks an fd), secrets, worktree residue, and renderer localStorage; then
  `beginQuit → relaunch → quit` so `before-quit` still runs. Never touched:
  `~/.claude`, `~/.codex`, clones on disk.
- **The rename** — Persona Router → **Switchboard**, and because the app is
  pre-release the rename is complete: display strings _and_ identifiers
  (package name → fresh userData profile, `switchboard.db`, `switchboard-ui`/
  `switchboard-panes` localStorage keys, appId/executableName/AppUserModelId,
  `SWITCHBOARD_GITHUB_MCP_TOKEN`). Deliberately unchanged: the `persona/*`
  branch prefix and `secrets/`/`worktrees/` dir names (they describe contents),
  `PERSONA_ROUTER_LIVE_REPO` (an external env contract), sample repo names in
  test data, and the historical record in docs/plan.
- **Polish** — sparkline hover tooltip; the eight palette swatches plus a
  random-hue die on the persona colour field; the persona's bot face in the
  composer's "Runs as" row.

## Verification

- 1328 unit / 58 E2E green at close; the reset service tested against a real
  temp profile (wipes what it owns, keeps a stray file it does not, branch
  deletion forced and failure-tolerant); the locked-token and unreadable-key
  states pinned from the claim; `github-token-state` and `call()`'s verdict
  recording got their first direct suites.
- Manual: reset from Settings relaunches into onboarding with the rewritten
  catalog; the locked state was simulated by corrupting a secret file.
- The full reset → onboarding walkthrough is the manual check because an E2E
  reset kills the app mid-run.
