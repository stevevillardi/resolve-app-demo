# Phase 3 — App Auth

**Status:** Not started
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

- [ ] Fresh install → app detects no auth → onboarding flow appears.
- [ ] Claude auth: either detects existing CLI auth, or accepts and stores an API key.
- [ ] Codex auth: SDK's own auth-reuse/device-login behavior confirmed working (or documented as broken/unverified with a fallback noted).
- [ ] GitHub device flow completes end-to-end: code shown, user authorizes in browser, app detects completion, token stored via `safeStorage`.
- [ ] Restarting the app after completing onboarding does not re-prompt.
- [ ] No token/key is ever written to SQLite or logs in plaintext — spot check by inspecting the DB file and console output.
- [ ] `auth.getStatus`-style procedure correctly reflects both backend states independently (e.g. GitHub connected but Codex not, and vice versa, both render sensibly rather than crashing).

## Open item to flag to the user during this phase

GitHub OAuth Device Flow requires a registered OAuth App client ID. Confirm whether one exists already or needs to be created (github.com → Settings → Developer settings → OAuth Apps) before this phase can be marked done — this is an external action, not something buildable in isolation.
