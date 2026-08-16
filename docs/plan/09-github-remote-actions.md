# Phase 9 — GitHub Remote Actions

**Status:** Not started
**Blueprint refs:** §9.2 (remote actions), §15D/§4 (githubScope governance)
**Depends on:** Phase 3 (GitHub auth token already stored), Phase 6 (real sessions producing changes to act on)

## Goal

Real write-side GitHub actions — push, open PR, comment — performed via the GitHub REST API (Octokit) from the main process, never by trusting an agent to shell out raw git commands unsupervised (blueprint §9 is explicit on this boundary). Surfaced as explicit user-triggered actions, not automatic side effects of a session ending.

## Scope

1. **Octokit REST client** (`@octokit/rest`) in the main process, authenticated with the token stored in Phase 3's `safeStorage` service.

2. **`OpenPRButton`**
   - Wire Phase 2's shell to a real action: given a Contact's session has made local changes (detect via git status on the bound `repoPath`, or track explicitly if the adapter reports files changed), push the branch and open a PR via the API.
   - This is explicitly a user-clicked action for interactive sessions (blueprint §9: "surface as an explicit action... not an automatic side effect").
   - For routine-triggered runs (Phase 8), this same code path is what fires automatically at the end of a routine run that made changes — reconcile this with the "explicit action" framing: the distinction is that the *routine itself* is the explicit, user-configured trigger (the user set `githubScope: open_pr` and enabled the routine), not that a human clicks a button per run. Document this distinction clearly since it's a subtle point the blueprint raises but doesn't fully spell out.

3. **`githubScope` enforcement**
   - `read_only` — no write API calls available to that persona's Contact, full stop (buttons disabled/hidden in UI).
   - `open_pr` — can push a branch and open a PR, cannot merge or push directly to a protected branch.
   - `full_access` — can push directly, merge, etc.
   - Per blueprint §13: this is "a permission label on the persona, not hard-enforced beyond what the token itself allows" — so enforcement is at the app's action-gating layer (don't show/allow the button), not a cryptographic guarantee. State this plainly in the UI copy if it comes up (e.g. a tooltip on a disabled action), matching blueprint §15B's precedent of stating v1 simplifications plainly rather than implying stronger guarantees than exist.

4. **Comment action** — post a comment on an existing PR/issue via the API, exposed wherever it's contextually relevant (e.g. Journey 3's "check for newly reported issues" could plausibly want to comment, not just open a PR — decide based on what the routine prompt actually asks for).

## Explicitly out of scope

- Any automatic merge — full_access allows it via API capability, but no UI shortcut is being asked for here beyond what's needed for the demo journeys.
- Branch protection rule management — out of scope entirely, not a v1 concern.

## Acceptance checks

- [ ] From a `workspace_write` + `open_pr` Contact with real local changes, clicking `OpenPRButton` produces a real PR on GitHub, verified by checking the repo.
- [ ] A `read_only` persona has no path to any write action anywhere in the UI.
- [ ] A routine configured with `open_pr` that makes changes ends by opening a PR automatically (no push to the default/protected branch).
- [ ] Attempting a push/PR action with an expired or revoked GitHub token surfaces a clear error (ties into Phase 6's failure-state bubble pattern), not a silent failure.
