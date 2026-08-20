# Switchboard demo runbook

The three journeys of [`ARCHITECTURE.md`](ARCHITECTURE.md) as a follow-along
script, written from two live end-to-end runs (2026-08-18). Every step below was actually driven, and
the timings and costs are what those runs measured. Total live spend for the
whole sequence: **≈ $1.40**, about 12 minutes of stage time.

The story arc, if someone asks what they're looking at: **Journey 1** proves
one persona doing real, permission-scoped work. **Journey 2** proves the
personas are *coordinated* — shared memory through the repo Group, not three
parallel chatbots. **Journey 3** proves bounded autonomy — scheduled work
that ends in a pull request and a visible bill, not a silent push.

---

## Prep (do this before anyone is watching)

**The demo repo.** Any GitHub repo you own works, but the journeys land best
on a small seeded one. The shape that works (mirrors
`stevevillardi/switchboard-journey-demo`):

- A tiny TS project whose **latest commit plants two review-worthy bugs** in
  one file — e.g. `src/auth.ts` gains session expiry where the expired branch
  still returns the session, and the TTL adds seconds to a millisecond clock.
  Journey 1's review catches both on stage.
- **Two open GitHub issues**, one trivially mechanical (a README typo is
  perfect). Journey 3's routine picks it and fixes it live.

**App state.** The demo starts from a fresh profile so onboarding is part of
the show. To reset between rehearsals: Settings → the dev-only reset, or
delete `~/Library/Application Support/switchboard/switchboard.db*` plus the
`worktrees/` and `demo/` folders with the app **quit** — credentials survive
both. (`npm run demo` instead stages a pre-populated showcase profile; that's
a different demo, not this script.)

**Auth.** Launch once the day before and confirm all three onboarding rows
are green: Claude (CLI login), Codex (ChatGPT login), GitHub. Two traps:

- **"This build can't unlock the stored GitHub credential."** macOS ties the
  encrypted token to the app binary — every rebuilt/other-checkout Electron
  is a new identity. Nothing is revoked; hit **Reconnect**, do the device
  flow once, move on. Do this *before* the demo, not during.
- **The first clone asks where clones should go** (native folder dialog).
  The confirm step warns you and the button says "Choosing a folder…" — just
  know the dialog is coming so you don't talk over it.

**Quit every other instance** of the app first — two instances share one
database and confuse each other.

---

## Journey 1 — scoped work (~2 min, one turn ≈ 30 s, ≈ $0.35)

*The foundational loop: persona → contact → real review under real
permissions.*

1. Walk onboarding: three green connections → **Continue** → the starter
   catalog's recommended trio (Code Reviewer, Refactor Buddy, Docs Writer) is
   pre-selected → **Continue** → skills step, defaults are right →
   **Finish setup**.
2. **Personas → Code Reviewer.** Point at the parts that matter: the system
   prompt, the two attached Skills (Security Checklist, TypeScript Style
   Guide), and the permission axes — `fs read_only`, `gh read_only`. Pick a
   model if you don't want the backend default (the runs used
   `claude-sonnet-5`). **Save.**
3. **Chats → ＋** → Code Reviewer → pick your repo from the GitHub list (it
   clones if not local — folder ask, then "Cloning…") → **Your checkout**
   (recommended for a reader) → **Create**.
4. Send: *"Review the changes in src/auth.ts — the latest commit added
   session expiry. Verdict first, then findings."*
5. **Expected:** a verdict-first reply in ~30 s — "**Must not merge**" —
   naming both planted bugs with file/line, calling the expiry one
   security-relevant (that's the injected Security Checklist showing), and
   flagging the missing tests. Point out the working tree stayed untouched:
   read-only means read-only, enforced, not requested.

---

## Journey 2 — coordination (~5 min, two turns + a mention, ≈ $0.70)

*The differentiated moment: agents that share memory through the repo Group.*

1. **Chats → ＋** → Refactor Buddy → same repo. The flow now recommends
   **Its own checkout** — say why: writers get their own git worktree and
   branch, so they never trample your files or each other. **Create.**
2. Send: *"Rename the notesFor function to notesForUser everywhere it
   appears, commit the change, and state your rationale for the new name."*
   Codex streams live tool progress; ~50 s.
3. Open the **repo Group**. The work posted as a **DECISION — kept
   indefinitely**: the rename, the commit id, and the warning that the branch
   isn't visible on disk to anyone else. This durable log is what every
   colleague's next session gets injected with.
4. Back to **Code Reviewer**, send: *"Anything I should know about recent
   activity in this repo before my next review?"* — **Expected:** it cites
   the rename, the exact branch and commit, and the merge-conflict risk,
   *without being told any of it*. This is the "so it's actually multi-agent"
   answer.
5. In the **Group composer**, type `@Do` — the typeahead pops with the
   roster; Enter completes `@Docs Writer `. Ask for *"a short changelog
   entry covering what changed in this repo today, based on the group
   notes."* — **Expected (~70 s):** the reply routes to Docs Writer's real
   session and lands in both the Group and its 1:1, followed by its own
   summary. In one run it tried to *write* the changelog file, the read-only
   sandbox refused, and it recovered with "I'm read-only in this session, so
   here's the draft to paste" — if that happens, it's a feature: point at it.

---

## Journey 3 — bounded autonomy (~4 min, routine ≈ 80 s, ≈ $0.10)

*Scheduled work, governed: a PR, never a push; a bill, never silent spend.*

0. Prereq from setup: Refactor Buddy's persona has the **GitHub tool**
   enabled (Personas → Refactor Buddy → Tools) so it can read issues, and its
   GitHub scope is `open_pr`.
1. **Routines → ＋**: runs as Refactor Buddy, any schedule (it fires "even
   when the window is closed" — the copy says so), prompt: *"Check this
   repository's open GitHub issues. Pick ONE trivial, mechanical one and fix
   it on a branch, then open a pull request — never push to the default
   branch. If nothing trivial is open, say so and stop."* Enable, **Save**.
2. **Provoke the lock on purpose:** send Refactor Buddy any quick message,
   and while it's working hit **Run now**. — **Expected:** "Skipped —
   Refactor Buddy · <repo> is already working here. Wait for it to finish, or
   stop it from that conversation." Recorded as the last run. One repo, one
   writer at a time, even for the scheduler.
3. When it's free, **Run now** again — then **close the window**. The app
   stays in the tray, the run continues, and a macOS notification lands when
   it finishes (~80 s). This is the 3-a.m. story told at 3 p.m.
4. Reopen and collect the evidence, in whatever order suits the room:
   - **Group** → the *routine run* row: what it did, the branch, and
     "**Opened PR #N.**" appended by the app itself.
   - **Branches** → the persona branch with its **PR chip**, Update PR /
     Merge buttons, and a Monaco diff of every file it changed.
   - **GitHub** → the PR: opened from the persona's branch, body quoting the
     persona's own summary, footer naming persona/backend/sandbox/scope.
     Never a push to `main`.
   - **Usage** → the whole session's spend split by persona, repo, model,
     and source — the routine's share visible under *Routines*.

---

## If something goes sideways

- **A turn errors** → it renders as an error bubble in-thread with a retry;
  a nonexistent/unavailable model says so and points at the persona's model
  picker.
- **A send is refused** → the composer keeps your draft and names who holds
  the repo. That's the write lock working, not a bug.
- **"Working…" that looks stuck** → it's genuinely still running (check the
  stop button); a finished turn clears itself within seconds even if you
  navigated away mid-turn.
- **GitHub anything fails mid-demo** → Settings → GitHub → Manage
  connection; the error text distinguishes "connect", "reconnect once (this
  build)", and "token revoked" — trust its wording.
- **Nuclear option** → Settings dev-reset relaunches to a fresh profile in
  ~10 s; the demo restarts at onboarding with all logins intact.

## After the demo

One command puts everything back to runbook-ready:

```bash
npm run demo:reset              # close PRs + delete branches + reopen issues,
                                # then wipe the clone and the app profile
npm run demo:reset -- --repo-only     # keep the app profile
npm run demo:reset -- --profile-only  # keep the GitHub state
npm run demo:reset -- --dry-run       # say what would happen
```

It refuses to touch the profile while the app is running, and never touches
credentials — the next launch starts at onboarding with all three rows green.
The demo repo is reusable indefinitely; the planted bugs only get "fixed" on
persona branches, never on `main`. Defaults target
`stevevillardi/switchboard-journey-demo`; override with `DEMO_REPO` and
`DEMO_CLONE`.
