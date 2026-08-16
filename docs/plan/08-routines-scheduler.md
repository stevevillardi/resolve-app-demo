# Phase 8 — Routines & Scheduler

**Status:** Done (pending Journey 3's PR step — see the dependency note)
**Blueprint refs:** §7 (routines), §15E (background/tray), §16 Journey 3
**Depends on:** Phase 7 (Group posting for `routine_run`), Phase 6 (concurrency lock, `AgentAdapter.run()`)

## Goal

Scheduled/unattended runs, built entirely in-app (not on any vendor's native scheduling, per blueprint §7's explicit warning about Codex's cloud-only/buggy scheduling). Includes the tray/background-residency requirement without which routines can't fire when the window is closed.

## Inherited from Phase 4 — what does and doesn't exist yet

Phase 4 created the **`routines` table only** (`drizzle/0002_add_blueprint_schema.sql`) and stopped there, deliberately. A Routine is bound to a Contact, and no Contact can exist until Phase 6, so routine CRUD would have meant shipping a create flow whose only foreign key had nothing to point at.

So everything below is still to build — none of it was partially done:

- **No IPC procedures.** `src/shared/ipc-contract.ts` has entries for skills, personas, contacts, and groups, but nothing for routines. Add `routines.list|get|create|update|delete` following the same pattern, with the entity schema in `src/shared/domain.ts` (`routineSchema` already exists and matches the table — reuse it, and add a `routineDraftSchema` for the id-less create input).
- **No service.** Add `src/main/services/routines.ts` alongside `skills.ts` / `persona-templates.ts`, which are the shape to copy.
- **`RoutineList` and `RoutineEditor` are still on mock data** (`src/renderer/src/mocks/routines.ts`), both marked with a comment pointing here. They are the last two components in the app reading mocked routines.
- **`ListPanel` has no "+" for the routines section** — Phase 4 added one for personas and skills but left routines out for the reason above. Add `newLabel: 'New routine'` to the `PANEL` map when there's somewhere to persist it.
- The table's `contact_id` is `ON DELETE CASCADE`, so deleting a Contact already takes its routines with it. Nothing extra to write for that.
- `enabled` is a Drizzle `boolean`-mode integer and `last_run_at` a `timestamp_ms`; `src/main/db/mappers.ts` already has `toRoutine` handling both conversions.

## Scope

1. **`Routine` CRUD + `RoutineEditor`**
   - Wire Phase 2's `RoutineEditor` shell to real `routines` table (Phase 4): schedule (cron expression) + prompt + enabled toggle, bound to a Contact.
   - Validate cron expressions client-side before save (clear error, not a silent bad schedule).

2. **Scheduler**
   - `node-cron` in the main process, loading all enabled `Routine`s and scheduling them from their cron expression on app startup (and re-scheduling on any create/update/delete/enable-toggle without requiring a restart).
   - On fire: acquire through Phase 6's `src/main/services/run-lock.ts`, the
     same way a user-sent message does. **Not** the `repoPath → busy` map
     blueprint §15D describes — see `00-progress.md`: the lock is a _write_ lock
     keyed on the working path, so a `read_only` routine never skips at all, and
     only a _writing_ routine can be refused.
   - A writing routine firing against a repo a user is actively working in is
     **the first genuine writer-vs-writer contention in the product** — a 1:1
     chat and an @mention are both things a human triggers and can see, whereas
     a routine fires unattended and will collide unannounced. It is the case
     `12-worktree-isolation.md` exists to solve: give the routine's Contact its
     own worktree and it stops competing for the user's tree entirely. If that
     phase hasn't landed, a refused routine must record _why_ it skipped in
     `lastRunSummary` rather than silently doing nothing.
   - Call `AgentAdapter.run(contact.session, routine.prompt)` — same code path as a user-sent message, no special "routine mode" branching in the adapter itself.
   - Result appends to the Contact's normal message history (opening the Contact shows what it did while "asleep") AND posts to the repo's Group as `routine_run`.
   - Log `UsageEvent` with `source: "routine"`.
   - Update `Routine.lastRunAt` / `lastRunSummary`.

3. **Manual "run now"**
   - Same code path as a scheduled fire, exposed as a button — blueprint §16 Journey 3 explicitly uses this for demo reliability instead of waiting on real cron timing. Make sure this really is the identical path (call through the same scheduler-fire function, don't special-case it), since the blueprint calls out this equivalence as something to be able to state truthfully if asked.

4. **Tray/background residency (blueprint §15E, hard requirement)**
   - On window close, keep the app resident via Electron's `Tray` API instead of quitting.
   - Tray menu: show window, list next-scheduled routines (compute next-fire time from each enabled Routine's cron expression), quit.
   - Confirm `node-cron` schedules genuinely keep firing with the window closed, not just minimized — test by closing the window, waiting for a scheduled fire, and checking the result appeared without reopening the window first.

5. **Governance default**
   - A Routine's Contact should default to `githubScope: "open_pr"` when created via the routine flow (or at minimum, strongly steer toward it in the UI) — unattended tasks propose via PR, not push unsupervised (blueprint §7).

6. **Optional: OS notification** on routine completion, especially if it opened a PR or flagged something needing review.

## Explicitly out of scope

- Cross-repo fan-out — one Routine is single-repo, single-prompt (blueprint §13).
- Automatic spend-threshold pausing — logging/display only in v1 (blueprint §13).

## Acceptance checks

- [ ] Blueprint §16 Journey 3 runs live: set up a routine with `githubScope: open_pr`, trigger via "run now," it reads the repo/issues, makes a change, opens a PR (verified this is a real PR via GitHub, not a push) — **deferred, see the dependency note**. The PR half needs Phase 9; the rest of the journey is a live check still to run.
- [x] The run posts to the Group as `routine_run`, visually distinct per Phase 2's `RoutineRunNotice`. `RoutineRunNotice` and its `case` in `GroupThreadView` already existed; what was missing was anything writing the row. Covered by `compaction.test.ts` and `messaging.test.ts`.
- [x] `UsageEvent` with `source: "routine"` is logged — asserted in `scheduler.test.ts`'s shared `expectRoutineRan` helper. Reflected in the `UsageBadge` by the same path every other source uses.
- [x] Closing the app window (not quitting) and waiting past a scheduled fire time results in the routine actually running, verified without reopening the window until after. **Automated** in `e2e/routines.spec.ts`, in two forms — window hidden, and window destroyed so `getAllWindows()` is genuinely empty — re-asserting on every poll that nothing is visible. Verified to fail when the scheduler is not started.
- [x] Tray menu correctly lists next-scheduled routines and quit actually terminates the process. Verified live 2026-08-16: the menu listed both enabled routines sorted by next fire with absolute local times, and **omitted the paused one**; "Show Persona Router" restored the hidden window; "Quit Persona Router" terminated the process, confirmed by pid rather than by the window disappearing.
- [x] Firing a **writing** routine while a writer holds its target repo results in a skip, with the reason recorded in `lastRunSummary` — not a concurrent run and not a silent no-op. `scheduler.test.ts`, written from the claim and confirmed to fail when the recording is removed.
- [x] Firing a **read_only** routine while a writer holds that repo runs normally: readers are never refused (Phase 6's lock semantics). Same file, and confirmed to fail when the lock is mutated back to the twice-fixed "any holder blocks" behaviour.

## Verified live (2026-08-16)

Things that cost real time or a real machine to observe, and so are recorded
here rather than in a test.

- **macOS does not App Nap the scheduler.** Chromium's `backgroundThrottling`
  covers renderers rather than main, but nothing in this app had ever run
  windowless for minutes, so it was measured instead of reasoned about: a
  30-second routine on a throwaway profile, window closed, fired **10 times in
  300 seconds** with gaps of 30, 30, 30, 30, 30, 30, 30, 30 and one 31. No drift,
  so no `powerSaveBlocker` — which would have been the fix, added on a guess.
- **`node-cron` resolves through the externalized `require`.** electron-vite
  externalizes every `dependency` in the main bundle (`require("node-cron")`
  appears verbatim in `out/main/index.js`), and node-cron's exports map has a
  real `require` condition, so none of the `await import()` treatment the
  ESM-only Codex SDK needed applies here.
- **`createTask` is inert but not free.** Used for the editor's next-fire
  preview: it reports `stopped` and never ticks, but it _does_ enter node-cron's
  global `getTasks()` registry, so the `destroy()` in `nextRunsFor` is load-
  bearing rather than tidying — without it every keystroke in the schedule field
  would leak a task into the same module the scheduler arms its real ones in.
  Pinned by a test that counts the registry across 20 calls.

## Dependency note

Journey 3's "opens a PR" step needs Phase 9's real GitHub write actions.
**Decided 2026-08-16: stub it here and close the check after Phase 9.** Execution
order stays 8 → 12 → 9, so the check above stays open across two phases; nothing
else in this phase depends on it.

## Limitations, recorded rather than solved

- **A missed fire is not caught up.** node-cron persists nothing and offers no
  exactly-once guarantee across restarts; its runner arms one timer to the next
  match and, on a late wake, drops any slot more than
  `missedExecutionTolerance` late. So a 09:00 daily routine is skipped outright
  if the machine slept through it or the app was quit. Decided to record the
  miss rather than fire late or fire on next launch — a catch-up pass would mean
  unattended writes starting the moment a laptop opens. `missedExecutionTolerance`
  is set to a minute rather than node-cron's 1000 ms default, which is aggressive
  for a process running synchronous SQLite and spawning SDK subprocesses on the
  same event loop.
- **Routine-vs-routine starvation is deterministic.** Two _writing_ routines on
  one repo with the same cron expression will have one win the lock and the other
  record a skip, every fire, forever — worse than the routine-vs-user contention
  the acceptance checks describe, because it never self-corrects. `12-worktree-isolation.md`
  is the real fix; nothing here works around it.
- **Nothing caps unattended spend.** A one-minute routine on an expensive persona
  burns money overnight. Blueprint §13 defers spend-threshold pausing to after
  v1, and this phase honours that; the editor shows the next fire time, which at
  least makes the frequency legible before saving.
- **The governance default has no flow to attach to.** Blueprint §7 wants a
  routine's Contact defaulted to `githubScope: open_pr` "when created via the
  routine flow", but routines bind to _existing_ Contacts and no
  create-contact-from-routine flow exists. Implemented as §7's "strongly steer"
  alternative instead: the editor shows the persona's scope chips beside who runs
  it, and cautions when that persona is `full_access`. Inventing a second contact
  creation path to satisfy the literal wording would have been worse.
