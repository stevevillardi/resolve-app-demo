# Switchboard

A macOS console for a fleet of coding personas. Each persona is a system
prompt, a set of injected Skills, and a permission scope; bound to one
repository it becomes a **Contact** you can message like a colleague. Contacts
on the same repository share a **Group** where their work summaries land, a
**Routine** wakes a Contact on a schedule while the app sits in the tray, and
every turn's tokens and dollars are on the **Usage** dashboard.

Backends: Claude (Agent SDK) and Codex (Codex SDK). The blueprint this app
implements is [`persona-router-blueprint.md`](persona-router-blueprint.md);
build history and every decision that shaped it live in
[`docs/plan/00-progress.md`](docs/plan/00-progress.md).

## Run it

```bash
npm ci                 # postinstall rebuilds better-sqlite3 for Electron
cp .env.example .env   # set GITHUB_CLIENT_ID (an OAuth app client id for device flow)
npm run dev
```

`npm run build` gates typecheck + the unit suite before bundling;
`npm test` runs the ~1,760-test unit suite alone; `npm run test:e2e` drives
the built app with Playwright against throwaway profiles.

## First run

Onboarding checks three connections and seeds a starter catalog:

1. **Claude** — found automatically if the Claude Code CLI is signed in on
   this machine; otherwise paste an `ANTHROPIC_API_KEY`.
2. **Codex** — reuses the Codex CLI's ChatGPT login; device-code flow if
   absent.
3. **GitHub** — OAuth device flow; the token is keychain-encrypted on disk.

Then pick starting personas (the recommended trio — Code Reviewer, Refactor
Buddy, Docs Writer — is what the demo below uses) and their Skills. The first
repository you bind will ask once where clones should land.

## Demo script — the three journeys

The full follow-along version — timings, expected outputs, the provoked
failure cases, and a recovery playbook — is
[`docs/demo-runbook.md`](docs/demo-runbook.md). The short form:

The three blueprint §16 journeys, back to back, on any repo you can take
branches and PRs on. Each exercises a different slice of the architecture.

### Journey 1 — scoped work (persona → contact → real review)

1. Personas → Code Reviewer: note the backend, the attached Skills, and the
   `read_only` sandbox. Pick a model if you don't want the backend default.
2. Chats → **＋** → Code Reviewer → pick the repo from the GitHub list (it
   clones if it isn't local) → *Your checkout* → Create.
3. Ask it to review something real ("review the changes in `src/auth.ts`").
4. Watch the reply stream: verdict first, findings with file/line, and no
   file ever touched — the sandbox denies writes and the persona knows it.

### Journey 2 — coordination (two personas, one repo, shared memory)

1. New contact: Refactor Buddy (`workspace_write`) on the **same** repo —
   note the flow now recommends *Its own checkout*: writers get a worktree
   and their own branch.
2. Give it a small refactor with a rationale ("rename X to Y, commit,
   explain"). When it finishes, open the repo **Group**: the work posted as
   a durable **DECISION**, stamped with its branch.
3. Ask Code Reviewer "anything I should know about recent activity?" — its
   fresh session cites the refactor, the commit, and the branch it can't
   see on disk, without being told. This is the coordinated moment.
4. In the Group composer, mention a third persona (`@` button) and ask for a
   changelog draft — the reply routes to that persona's real session and
   lands in both threads.

### Journey 3 — bounded autonomy (routine → PR → cost)

1. Routines → **＋**: run as Refactor Buddy (`gh open_pr` — enable the
   GitHub tool on the persona so it can read issues), any schedule, prompt
   like "check open issues, fix one trivial one, open a PR — never push to
   the default branch."
2. Click **Run now** (same code path as the scheduled fire). Close the
   window — the app stays in the tray, the run continues, and a system
   notification lands when it's done.
3. The result posts to the Group as a **routine run**; the PR is on GitHub
   and in the Branches panel (chip + Update PR / Merge); the spend is on the
   Usage dashboard, split by persona, repo, model, and source.

Worth provoking on purpose: "Run now" while that contact is already working
answers with a legible skip that names the holder, and a second message to a
busy writer keeps your draft instead of queueing — while a `read_only`
persona on the same repo chats freely the whole time.

### Staged demo profile

`npm run demo` (`SWITCHBOARD_DEMO=1`) rebuilds the profile as a pre-populated
showcase on every launch — same pristine state however the last rehearsal
ended. `SWITCHBOARD_DEMO_REPO` overrides which checkout it binds.

## Live checks

Behaviour that costs money or needs the network is checked in behind env
vars, re-runnable on demand (see `CLAUDE.md` for the full table):
`LIVE_CODEX_CONTEXT`, `LIVE_GITHUB`, `LIVE_JOURNEY2`, `LIVE_JOURNEY3`,
`LIVE_WORKTREES`, plus `npm run probe:adapters` / `probe:structured` /
`probe:mcp` for driving the real SDKs outside Electron.
