# Phase 17 — v1 wrap

**Status: Done**
**Blueprint refs:** §4, §5, §10, §15A/§15E — plus the closure of doc 15's deferred list and doc 16's still-open items, so that every phase doc except 11 reads Done.
**Branch:** `phase-17-v1-wrap`, 24 commits.

## Why this phase exists

The app was functionally complete but not finished. Using it surfaced the gaps a
phase-by-phase build leaves behind: onboarding was one auth screen that created
nothing; Home said less than the tray; the dev menu bar said "Electron"; a
desktop app had no right-click anywhere; avatars were initials; and several
things were set exactly once with no way back — Claude/Codex auth after
onboarding, the contact's persona binding, the workspace root. Two live bugs:
editing a persona under an active chat surfaced a raw vendor "failed to resume
session" string, and the Codex auth probe false-negatived while Codex chats ran
fine.

## The two bugs, root causes

- **Codex probe false negative.** `codex login status` runs under a 15s
  `spawnSync` timeout; on timeout `status` is `null`, which fell through to the
  same bare `{authenticated: false}` as a clean logout — stderr discarded, no
  error field, and `resolveCodexBinary` memoized its first miss forever. A cold
  ~220MB binary can outlive that timeout. Now only exit-1-with-"Not logged in"
  reads as logged out; every other outcome is _detection failure_, kept
  authenticated when an API key is stored (turns inject it themselves), with the
  reason shown and a "Check again" retry — plus an automatic re-probe on window
  focus that runs **only while a probe has admitted failure**, so a healthy
  status never pays for a focus-triggered subprocess.
- **The resume error.** Nothing ever cleared `contact.backendSessionId`, and
  `personas.update` could change `backend` with live bound contacts — handing
  Codex a Claude UUID on the next turn. Three layers now: a backend change
  clears bound contacts' resume keys in the same transaction (model-only changes
  don't — both SDKs accept a model on resume); `classifyErrorMessage` gains a
  `session` kind; and `runTurn` retries a session-kind failure once with a fresh
  session, only for a resume that has streamed nothing. The transcript lives in
  our database, so the healed turn loses nothing visible.

## What landed, by area

- **UI infrastructure:** a sonner toast layer (policy: transient confirmations
  only, form errors stay inline); a Base UI ContextMenu primitive sharing item
  styles with the dropdown through `ui/menu-styles.ts`; a native cut/copy/paste
  menu on editable fields (gated on `params.isEditable` — the renderer owns
  right-click everywhere else); DiceBear bottts avatars
  (`@dicebear/core@9` + `@dicebear/bottts@9` — core 10 is incompatible with the
  style package, deliberately not taken) seeded by persona id and tinted by
  `avatarColor`, behind the single `AvatarColorSwatch` component so all
  seventeen render sites changed at once.
- **Right-click everywhere:** `ListRow` gained an opt-in `contextMenu` prop —
  every list goes through it. Contacts (the same `ContactActionItems` the ⋯ menu
  renders, so the two cannot drift), personas (duplicate, delete), skills,
  routines (pause/resume, run now, delete), branches (discard only — merge and
  PR need the detail pane's target choice and conflict preview), and message
  bubbles (copy, previously impossible). Menus never delete directly; they open
  the same ConfirmDeleteDialogs the editors use.
- **App identity:** a real application menu (`app-menu.ts` as pure data, the
  tray-menu split; accelerators tested unique), `app.setName` with **userData
  pinned first** — `setName` moves `getPath('userData')` and the database lives
  under the old path — a dev dock icon, and menu verbs (⌘N/⌘K/⌘,) travelling to
  the renderer over a menu-action channel onto the same store transitions the
  buttons use. The bold dev app-menu title alone still reads "Electron": macOS
  takes it from the running bundle's Info.plist, and in dev that bundle is
  node_modules/electron. The packaged app is right everywhere.
- **Tray:** real separators, routine rows capped at five with the overflow
  counted, a clickable "N turns running" line mirrored in the macOS tray title,
  rebuilt via a main-side listener on `emitRunsChanged` (a direct import would
  close the tray → messaging → agent-events cycle).
- **Home:** a Scheduled card (new `routines.nextRuns`, the tray's data joined to
  contact names), a seven-bar spend sparkline (`dailySpend` — exactly the
  window, zero-filled, unlike `bucketByDay`), and a degraded-auth banner where
  `rejected` warrants one and `unreachable` deliberately does not.
- **Onboarding and the catalog:** three steps ending in a chooser over a
  two-tier starter catalog (8 personas / 11 skills; the recommended tier is
  exactly the pre-17 content and remains what startup seeds, so a skipper gets
  exactly what every install before this phase got). `applyStarterSelection`
  aligns installed starter content with a selection — unknown ids are an error,
  required skills come along, removal refused where it would strand a contact or
  strip an attached Skill, user-created rows untouchable. The starter library
  dialog is the durable re-entry point; the `onboarding_completed` flag is never
  cleared.
- **Settings:** the app's first post-onboarding auth surface — key entry _and
  removal_ (clearing the OpenAI key signs the codex CLI out only when the key
  was how it signed in; a ChatGPT login is not ours to revoke), the workspace
  root made visible and changeable, theme, the library, About. A dialog, not a
  nav section.
- **Contact flows:** `contacts.rebindPersona` — the one binding change that can
  be made safe (clears the resume key in-transaction, refuses mid-turn, keeps
  everything else; pinned by a whole-row test) — and guided recreate:
  NewContactFlow prefilled from an existing contact, with an honest
  delete-the-original option that quietly keeps it when main refuses over
  uncommitted work. Repo and isolation stay immutable.
- **Doc 15 executed:** full_access now _forces_ full GitHub scope (refused at
  the Zod boundary and the service, existing rows normalized by migration 0010,
  the editor explains rather than disables); tool calls persisted as **name and
  status only** (migration 0011 — never arguments, pinned by a test that greps
  stored rows for the fake turn's argument strings; interrupted calls render as
  interrupted); the GitHub token env narrowed to Codex (Claude uses the header
  and has no reader for the variable); `CLAUDE.md`/`AGENTS.md` both read when
  they differ, once when identical; and the Codex prompt-block ordering pinned
  by the test that is now its only enforcement.
- **Doc 16 closed:** DeviceCodeDisplay gained the countdown both flows always
  knew; BreakdownRows' name column went proportional; the ConfirmDeleteDialog
  call sites were finally read side by side and now share one visual grammar for
  "here is exactly what this act reaches"; GroupThreadView reviewed in the
  sweep at both widths.

## Decisions recorded (see 00-progress.md)

- Doc 15 item 1 → **persist name + status only.** Item 2 → **refuse the
  combination.** Items 3/4/5 → accepted limits, recorded not reopened.
- Durable-entry retention → **explicitly deferred**: no observed pain, groups
  are short-lived in v1, revisit when compaction pressure appears. An untested
  cap invented now would be governance theatre.
- Phase 10's live pass stays manual: `LIVE_CODEX_CONTEXT=1`, `LIVE_GITHUB=1`,
  `LIVE_JOURNEY2=1`, `LIVE_JOURNEY3=1`, `LIVE_WORKTREES=1` gate the checked-in
  `*.live.test.ts` suites; they cost real money and run when a human decides.

## Verification

- 1299 unit tests (21 skipped) and 58 E2E green at close; every commit carried
  its own tests per CLAUDE.md. New E2E: the onboarding chooser walked for real
  (deselect lands deleted, optional pick lands installed, locked skill rows
  hold, user rows untouched), right-click on a conversation row (including that
  it does not select — selection would swap the detail pane under the menu).
- `npm run screens` re-run at close; the avatar change touches nearly every
  shot, reviewed once as intended.
- Deliberate-mutation checks: the resume self-heal suite fails if the retry
  loops, re-enters on non-session errors, or double-records usage.

## Still open / known limits

- Group turns don't persist tool calls (1:1 only in v1) — noted at the write
  site.
- The onboarding chooser is not in the screenshot sweep (it needs a fresh
  profile mid-sweep); it is covered by the E2E walk instead.
- Phase 11 (demo journeys, the §13/§15 audits, the runbook) remains the one
  intentionally open phase.
