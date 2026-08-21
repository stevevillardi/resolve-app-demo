# Switchboard

A macOS console for a fleet of coding personas. Each persona is a system
prompt, a set of injected Skills, and a permission scope; bound to one
repository it becomes a **Contact** you can message like a colleague. Contacts
on the same repository share a **Group** where their work summaries land, a
**Routine** wakes a Contact on a schedule while the app sits in the tray, and
every turn's tokens and dollars are on the **Usage** dashboard.

Backends: Claude (Agent SDK) and Codex (Codex SDK). How it is put together,
and why — the process boundary, the two adapters, the sandbox and GitHub
permission axes, and what the app deliberately refuses to do — is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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

## Live checks

Behaviour that costs money or needs the network is checked in behind env
vars, re-runnable on demand (see `CLAUDE.md` for the full table):
`LIVE_CODEX_CONTEXT`, `LIVE_GITHUB`, `LIVE_JOURNEY2`, `LIVE_JOURNEY3`,
`LIVE_WORKTREES`, plus `npm run probe:adapters` / `probe:structured` /
`probe:mcp` for driving the real SDKs outside Electron.
