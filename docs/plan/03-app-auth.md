# Phase 3 — App Auth

**Status:** Done — all 7 acceptance checks verified (2026-08-16)
**Blueprint refs:** §15A (Claude/Codex authentication), §9 (GitHub integration — auth half only)
**Depends on:** Phase 1 (bootstrap). Runs in parallel conceptually with Phase 2 output but should land after it so onboarding has a real shell to render into.

## Goal

Two independent auth concerns, done together because both gate every later phase and share first-run onboarding real estate:

1. **Agent backend auth** — can this app actually call Claude and Codex.
2. **GitHub auth** — can this app read the user's repos and later act on them (push/PR).

Neither is about *using* these credentials yet (no adapters, no repo picker calling the real API) — this phase is "acquire and securely store the credentials, and reflect auth state in the UI." Real usage of GitHub's API for repo listing lands in Phase 6 (`NewContactFlow`); real usage of Claude/Codex auth lands in Phase 5 (adapters).

## Scope

1. **Claude/Codex SDK auth (blueprint §15A)**
   - On first run, check for existing Claude Code CLI auth on the machine (however the Claude Agent SDK surfaces that check — confirm the actual API during implementation, don't assume).
   - If absent, prompt for an `ANTHROPIC_API_KEY` and store it via `safeStorage`.
   - Codex: per blueprint, `@openai/codex-sdk` reuses existing Codex auth automatically, with its own device-code browser login if none exists — install the SDK now and confirm this behavior in practice, since it's load-bearing for this whole phase's UX (if the SDK's own login flow is not embeddable/triggerable the way assumed, that changes the onboarding design).
   - This is a one-time first-run step, not a per-persona setting (blueprint is explicit on this) — store auth state at the app level.

2. **GitHub OAuth Device Flow (blueprint §9)**
   - `@octokit/auth-oauth-device` — no local redirect server needed.
   - Requires a GitHub OAuth App (or GitHub App) client ID to be registered — **this needs a decision/action from the user before this phase can be completed**: either use a personal-use OAuth App client ID or flag this as an open item if not yet created. Note this explicitly if blocked.
   - Store the resulting token via Electron's `safeStorage` API — never plaintext, never in the SQLite DB unencrypted.
   - `GitHubConnectDialog` component (shell built in Phase 2) wired to real device-flow state: show the user code + verification URL, poll for completion, reflect connected state.

3. **Onboarding flow**
   - First-run sequence: Claude/Codex auth check → GitHub connect → land in the (still mostly empty) main app shell.
   - Auth state should be checkable via an IPC procedure (`auth.getStatus` or similar, registered through Phase 1's hand-rolled `ipc-contract.ts` layer) so the renderer can gate navigation (e.g. don't let the user reach `NewContactFlow` in later phases without GitHub connected).
   - Persist "onboarding completed" state so returning users skip straight to the app.

4. **Token storage layer**
   - One small main-process service responsible for all `safeStorage` reads/writes (GitHub token, Anthropic API key if manually entered). Don't scatter `safeStorage` calls across multiple files — centralize so the encryption boundary is auditable in one place.

## Explicitly out of scope for this phase

- Actually calling the GitHub REST API for repo listing (Phase 6) or PR/push actions (Phase 9).
- Actually invoking the Claude/Codex SDKs to run a session (Phase 5).
- Per-persona auth overrides — there are none, per blueprint §15A.

## Acceptance checks

- [x] Fresh install → app detects no auth → onboarding flow appears. *(Splash → onboarding verified on a profile with no `onboarding_completed` row.)*
- [x] Claude auth: either detects existing CLI auth, or accepts and stores an API key. *(Detected existing CLI auth: `source: "cli"`, email + org + `Claude Pro` returned.)*
- [x] Codex auth: SDK's own auth-reuse/device-login behavior confirmed working (or documented as broken/unverified with a fallback noted). **The blueprint's assumption was wrong — see the correction below.** Reuse detection and the device-code login both work via the vendored CLI.
- [x] GitHub device flow completes end-to-end: code shown, user authorizes in browser, app detects completion, token stored via `safeStorage`. *(Confirmed by the user. Resulting state: `github_token.bin` written at mode `0600` with a `v10` keychain-encrypted prefix, `github_account_login=stevevillardi` and `github_scopes=repo read:user` in `app_state`, and zero token-shaped strings anywhere in the DB.)*
- [x] Restarting the app after completing onboarding does not re-prompt. *(`completeOnboarding` → reload → app shell, not onboarding.)*
- [x] No token/key is ever written to SQLite or logs in plaintext. *(`app_state` holds only `onboarding_completed`; no token-shaped strings anywhere under userData or in console output; `safeStorage` round-trip confirmed `v10`-prefixed ciphertext at mode `0600` that does not contain its plaintext.)*
- [x] `auth.getStatus` reflects backend states independently. *(Claude + Codex authenticated while GitHub disconnected rendered correctly; the sidebar dot read `data-connected=false` in the same pass.)*

## Tests

Added 2026-08-16, alongside a retroactive pass over Phases 1–2 — see the testing decision in `00-progress.md`.

| Area | File | Covers |
|---|---|---|
| Encryption boundary | `src/main/services/secrets.test.ts` | round trip, `0600` mode, plaintext never on disk, refusal when no keychain, recovery from foreign ciphertext |
| App state | `src/main/services/app-state.test.ts` | real in-memory SQLite, upsert, flag semantics |
| GitHub device flow | `src/main/services/github-auth.test.ts` | transitions, generation guard against late resolves from a cancelled flow, error translation, disconnect |
| Codex | `src/main/services/codex-auth.test.ts` | device-code parsing against captured real CLI output, chunk merging, `login status` mapping, key on stdin not argv |
| Claude | `src/main/services/claude-auth.test.ts` | `AccountInfo` mapping, session teardown, caching, `process.env` spread |
| Aggregation | `src/main/services/auth-status.test.ts` | all eight connected/disconnected combinations |
| IPC boundary | `src/main/ipc/registerProcedure.test.ts`, `src/shared/ipc-contract.test.ts` | dispatch, unknown procedure, input/output validation, schema shape |
| Launch flow | `e2e/launch.spec.ts` | real app: splash → onboarding → shell, migrations, relaunch persistence, allowlist enforcement |

`applyDeviceAuthOutput` was extracted from the spawn handler in `codex-auth.ts` so the parsing is testable without launching a 220MB binary.

Two constraints worth knowing: E2E redirects `HOME`/`CODEX_HOME` at a throwaway profile, but Claude Code's login is in the macOS Keychain and **cannot** be isolated that way, so E2E asserts the shape of `claude` rather than that it's signed out. And the collapsed nav rail's buttons have no accessible name (labels are `display:none`), so use `waitForShell` rather than role/name queries.

## Resolved: blueprint §15A is wrong about Codex

§15A says Codex's SDK handles login itself, "with its own device-code browser login if none exists." Verified against `@openai/codex-sdk@0.147.0`: the SDK exports only `Codex`, `Thread`, and `CodexOptions { codexPathOverride, baseUrl, apiKey, config, env }` — **no login or auth API of any kind**. That behaviour belongs to the `codex` CLI, which the SDK vendors as a dependency.

Driving that CLI directly turned out to be *better* than what the blueprint assumed, because it exposes a device-code flow with the same shape as GitHub's:

| Command | Behaviour (confirmed by running the vendored binary) |
|---|---|
| `codex login status` | exit 0 `Logged in using ChatGPT` / exit 1 `Not logged in` |
| `codex login --device-auth` | prints `https://auth.openai.com/codex/device` + a one-time code (e.g. `UHHW-B1Z5X`), 15-minute expiry; exits 0 on completion |
| `codex login --with-api-key` | reads the key from **stdin**, so it never appears in argv or `ps` |
| `CODEX_HOME` | honoured — lets a logged-out profile be tested without touching real credentials |

Because both providers are device-code flows, they share one `DeviceFlowState` shape in the IPC contract and one `DeviceCodeDisplay` component.

Detection uses `login status` rather than sniffing `~/.codex/auth.json`, so an expired or malformed credential reads as logged out instead of as connected.

## Resolved: Claude auth detection

`Query.accountInfo()` resolves **without consuming a turn**, provided the query is created with a prompt stream that never yields and is `close()`d afterwards. No fallback to probing `~/.claude/.credentials.json` was needed.

## Resolved: GitHub OAuth App

A client ID already existed and is in `.env`. Device Flow is enabled on the app (verified by a live device-code request). `electron-vite` only exposes `MAIN_VITE_`-prefixed vars to main, so `envPrefix` in `electron.vite.config.ts` was widened to accept `GITHUB_` as well — the existing unprefixed `GITHUB_CLIENT_ID` works with no rename.
