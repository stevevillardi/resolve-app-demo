# Phase 23 — Polish & export

## Context

The 2026-08-17 workflow review ("The Missing Half of the Loop") named three
systemic findings and two lists of smaller ones. The systemic three are closed:
§1 became Phase 19, §2 became Phase 20, §3 became Phase 22. This phase takes
**§G — the six low-severity items** — as a single pass, because each is small
enough that a phase per item would cost more in ceremony than in code, and
several touch the same files.

It also lands a defect that arrived _with_ the review follow-up rather than in
it, and it goes first because this repository lands defect fixes ahead of the
feature that surfaced them.

## The defect: the context-window table

Phase 22 shipped `src/shared/context-windows.ts` and recorded an open item —
the three Claude 5 rows were marked `inferred` and wanted confirming. The
confirmation said those three were right to distrust, and that four rows marked
`published` were wrong as well.

| Tier | Models                                                    |
| ---- | --------------------------------------------------------- |
| 1M   | Opus 4.6, 4.7, 4.8, Opus 5, Sonnet 4.6, Sonnet 5, Fable 5 |
| 200k | Haiku 4.5, Sonnet 4.5, everything older                   |

All eight ids in this app's picker had been recorded at 200k. The meter divides
by that number, so it had been reporting a prompt using half of Opus 4.8's
context as **full**, and the remedy it invites — a fresh session — costs the
model's memory of the thread.

**What is worth carrying forward is not the numbers.** It is that `source`
answers _how a figure was obtained_ and says nothing about _whether it is still
true_. A `published` row goes stale exactly as quietly as an `inferred` one, and
the four wrong-and-unflagged rows are the proof. `CONTEXT_WINDOWS_LAST_VERIFIED`
is the field that carries currency, and the file header now says so.

No unit test can check a transcribed number against a vendor's page, and none
here pretends to. Three things are pinned instead:

- a tier table, so an edit flattening the table back to one figure fails;
- a cross-check in `claude.test.ts` against the one window this repository has
  **measured** — the captured SDK fixture stamps `contextWindow: 200000` on
  Haiku — through the same dated-id lookup the meter uses;
- an e2e assertion left seeded on a 1M model, so the same fixture reads 25%
  again the moment anyone reverts the table.

Two things deliberately did not move. Claude's cost comes from the SDK's own
`total_cost_usd`, so `pricing.ts` is Codex-only and no spend figure changed. And
`LONG_CONTEXT_THRESHOLD` stays 272k — that is OpenAI's input _tier boundary
inside_ the GPT-5 window, not a window, and the two numbers sit two files apart
looking alike.

---

## §G1 — Keyboard coverage

The whole vocabulary was ⌘K, ⌘N, ⌘,, ⌘B and `/`: enough to open things, nothing
to move between them, in an app whose premise is several conversations at once.

**⌥↑ / ⌥↓ — previous and next conversation.** ⌘↑/⌘↓ is the Messages binding and
was the first instinct, but on macOS those move the caret to the start and end of
a text field, and the composer holds focus for most of the time anyone spends
reading a thread. ⌥↑/⌥↓ are Slack's channel keys and are free in a short chat
composer.

Bound inside `ConversationList` rather than in a global hook, because that is
where the rendered order exists. Recomputing it elsewhere would be a second
ordering to keep in step with the first, and drift shows up as a key that skips a
row the user is looking straight at — the shape of bug Phase 22 fixed in the
composer's lock check. The rule states in one line: **move to the next row you
can see.** A filtered list is walked as filtered; when the panel is not on screen
the binding is not registered.

Wrapping rather than clamping: a switchboard holds a handful of conversations, so
cycling is cheap, and a key that goes dead at the last row is indistinguishable
from a key that is broken.

**⌘L — the composer.** In `Composer` itself, which owns the ref and is mounted
exactly once (`WorkspaceView` renders the 1:1 thread or the group thread, never
both). A focus token in the UI store would have had to survive the remount on
every conversation change, in exchange for nothing. The caret goes to the end
rather than selecting: drafts survive conversation switches (Phase 21), so there
is often a half-written message in the box and selecting it would turn the next
keystroke into a deletion.

Both go into `shortcutHints`, the app's only inventory of its own keys — an
undiscoverable shortcut is not a feature. That surfaced a real bug: the hint was
written as the literal `⌥↑ ⌥↓` and would have rendered a macOS glyph on Windows.
⌥ is the only modifier the application menu never sees, so nothing in
`MENU_ACCELERATORS` could have caught it. Hence `altKey()` beside `modifierKey()`.

## §G2 — Export

The review's phrasing is the brief: _"the honest cost data deserves an exit
door."_

**The rule that outranks both formats:** an unknown cost leaves as an empty cell,
never a zero. Inside the app a null renders `—` beside a tooltip that explains
it; in a spreadsheet nothing explains it, and someone will sum the column, where
a zero is summed as free rather than skipped as unknown.

Markdown keeps message content **verbatim**, and that decides the frame: a reply
routinely contains its own fenced code and headings, so speakers are `###`
headings rather than blockquotes — quoting would mean rewriting every line and
turning a faithful copy into an approximation. Session breaks carry across with
the thread's own wording, because an export that dropped them would read as one
continuous conversation. Per-turn costs ride under each reply, and an unpriced
one says "no published price" in full: a dash is legible next to a tooltip and
meaningless in a file opened somewhere else six months later.

**`files.saveText` is the app's first write outside the profile directory.**
`shell.openPath` and `shell.revealPath` are allowlisted through
`isKnownLocalPath` on purpose; this deliberately is not, and the difference is
`showSaveDialog`. The renderer never names a destination — it proposes a
filename, and a person picks the folder in an OS panel and can decline. That
panel _is_ the authorization; an allowlist over it would only mean refusing to
write where the user just said to. It lives in `procedures/shell.ts` beside the
allowlisted two, so the next person adding a reach-outside procedure reads the
rule and the exception together.

The CSV exports **what is on screen** — scope, range and source filter all apply.
A button on a filtered view that quietly saved everything would be the one export
nobody could reconcile against the chart it came from.

## §G3 — The repo picker past 100

`listRepos` asked for one page of 100 and the picker presented it as the account,
so anyone past a hundred repositories was told theirs did not exist. The cap was
named only when a filter matched nothing, so scrolling an unfiltered list of
exactly 100 said nothing at all.

**Paged rather than searched**, which is the part worth arguing.
`/search/repositories` is the obvious reading of "no server-side search" and the
wrong tool: it has no concept of "repositories I can reach", so it needs the
viewer's login and every org they belong to spliced in as qualifiers — an extra
call to build, wrong the moment someone joins an org, and silently returning all
of public GitHub if a qualifier is ever dropped. It also reads an index that lags
a freshly created repository by minutes, which is exactly when someone is trying
to bind one.

Ten pages of 100. `octokit.paginate` stops as soon as a page comes back short, so
a 40-repository account still costs one request.

A defensive `.slice()` on the result was written first and turned out to be
**unreachable** — 1000 is a whole number of 100-row pages, so `done()` lands
exactly on it and no test could make the slice fail. Mutation-checking found
that, and the guard moved to an executable assertion of the real invariant: a
limit falling mid-page would overshoot, and `isPossiblyTruncated` compares
against the constant, so it would stop firing and a truncated list would again be
presented as the whole account — the original bug, reachable through a plausible
edit to a constant in another file.

## §G4 — The new-contact flow

Three gaps in the step that asks the app's first questions.

**Find one.** An unranked list with no search — fine for the three seeded
personas, not fine once anyone opens the starter library's other five.
`filterPersonas` reuses `scoreCommand` and matches backend and scope as well as
the name, because both are shown on the row as badges and a filter that could not
match them would mean the visible text and the searchable text disagreed. The box
appears only past `PERSONA_FILTER_THRESHOLD`.

**Make one.** There was no way to add to that list from here, so the answer to
"none of these" was: cancel, go to Personas, work out that "new persona" means
editing a blank draft, save, start again. `QuickPersonaDialog` asks for the five
fields the draft schema requires and hands back the persona selected. A second
dialog rather than a fifth step — creating a persona is a detour, and putting it
in `STEPS` would make the progress dots claim a five-step process for everyone.
Deliberately not the full editor: duplicating that panel would leave two forms to
keep in step and the second would lose.

That makes `requireScopePairing` reachable from a form for the first time, and it
is handled by making the refused combination **unrepresentable** — full disk
access raises the GitHub scope with it and then offers only the value that pairs.
A form that lets a combination be assembled and then refuses it teaches the rule
by failure, and this rule is about permissions.

**Name one.** `displayName` was derived and unaskable. The field holds null until
someone types, so it keeps tracking the persona and repository while those are
still being chosen — a string seeded on mount would freeze the first persona's
name and survive going back a step. The placeholder is the same `derivedName()`
the create call falls back to, so it never advertises a name the contact does not
get.

That reached an asymmetry worth closing: `contacts.update` refused a rename to
nothing while `contacts.create` accepted a contact called nothing — unreachable
while the name was derived.

## §G5 — Groups

Group rows were the last thing in the sidebar with no context menu, and there was
nothing behind one to call: `groups.*` was four read-ish procedures, none of
which wrote anything a user had chosen. Since `ensureGroupForRepo` runs inside
`createContact`, binding a second persona to a repository silently added a row
nobody could act on.

**Migration 0021, two nullable columns, null carrying the meaning in both** —
which is what lets an upgraded profile behave exactly as it did with nothing
backfilled.

`name` null means _derive from `repo_path`_. Storing the derived name at creation
freezes it: a repository moved on disk would keep the old folder's name forever
with nothing to explain why. As a nullable override, clearing the field **is**
the reset, so `groups.rename` takes `string | null` and needs no second
procedure. Typing the repository's own name into the dialog collapses to null for
the same reason.

`hidden` null means visible. **Hiding is not deletion, and there is no delete to
fall back on:** a group is a _view_ of the contacts bound to a repository, so
removing the row while those contacts exist only means `ensureGroupForRepo`
recreating it on the next turn — with its read boundary reset, lighting up every
old message as unread.

Two consequences worth stating. A search still reaches hidden groups: hiding
governs the list's _resting_ state, and answering "nothing matches" when someone
types the name of a group they hid is both wrong and what would make hiding feel
like deletion. And the way back is a count at the foot of the list rather than a
permanent "Hidden" section — the row exists to be found once, not to reinstate
the clutter hiding was meant to remove.

`GroupActions` mirrors `ContactActions` down to the `Item` alias serving both
menu families. A group row acquiring a menu that behaved differently from a
contact row's would be worse than the none it had.

## §G6 — Per-turn cost in the thread

Every figure was already recorded — one `usage_events` row per turn, with tokens,
model, cost and where the cost came from — but nothing tied a row to the message
it paid for, so spend could only be summed.

**Migration 0020 adds `usage_events.message_id`**, written in `finish()` where
the id is already in hand, alongside the tool-row stamp and the session stamp.

Correlating by timestamp was the tempting no-migration route and is wrong three
ways: a turn with no final text writes a usage row and no message; compaction
records `summary` spend with neither message nor session; a mention writes two
message rows for one usage row. Each is a case where a positional pairing puts a
cost under the wrong reply, silently.

**The referential action would have shipped broken.** drizzle-kit emits the FK on
an ADD COLUMN with no action at all — its own snapshot records `set null`
correctly, so only the SQL emitter drops it — and SQLite defaults to NO ACTION.
`messages` cascades from `contacts`, so under NO ACTION the usage row _blocks_
the cascading message delete. Executed against real SQLite with the pragma this
app sets:

```
as generated   DELETE FAILED: FOREIGN KEY constraint failed
set null       deleted ok, usage row kept, cost_usd intact
```

That means deleting any contact that had ever run a turn would throw, and
`clearAppData` with it. The clause is hand-written into the migration with the
reason above it, and three tests in `upgrade.test.ts` fail if a regeneration
removes it.

SET NULL rather than CASCADE for the same reason `contact_id` uses it: Phase 10's
rule is that spend outlives what spent it.

`TurnCost` is the third question in the set the other two usage surfaces answer —
`UsageBadge` says what a conversation has cost, `ContextMeter` how much room is
left, this what _that_ answer cost. Deliberately the quietest thing in the
thread, because it renders under every assistant bubble.

---

## Migrations

- **0020** — `usage_events.message_id`, nullable, `ON DELETE SET NULL`
  **hand-written** (see above). Nothing backfilled: null means "not recorded",
  which is true of every row written before it and every turn with no reply.
- **0021** — `groups.name` and `groups.hidden`, both nullable, both with null as
  the meaning. Nothing backfilled.

Both are pure `ADD COLUMN`, which is what keeps 0017's FTS triggers alive.

## Verification

- `npm run build` — typecheck + unit suite + bundle. **1,762 passing**, up from
  1,689.
- `npx playwright test --project=e2e` — **92 passing**, up from 77.
- `npm run screens`, both themes at both widths.
- Mutation checks, each failing exactly its own test: the modal guard and the
  group rows in the ⌥↓ order; `ON DELETE SET NULL` in 0020; `groupName`'s
  override and `ensureGroupForRepo`'s preservation; the page cap; the typed
  contact name; the null-cost rule in the CSV, at both unit and e2e level.

Two of those are worth recording as method notes rather than results.

**A mutation that passes is not always a test with no teeth.** The `.slice()` in
§G3 could not be made to fail because it was unreachable; the right response was
to delete it and assert the invariant instead. Separately, a first attempt at the
`ensureGroupForRepo` mutation changed a column the test did not claim anything
about — the mutation was wrong, not the test.

**Piping a build into `tail` can leave you testing the previous bundle.** An
`electron-vite build 2>&1 | tail -2` was killed by SIGPIPE partway through, so
Playwright ran the old `out/` and a mutation appeared to pass. Redirect to a file
and check the exit code.

## Not done, deliberately

- **A "Hidden" section for groups.** The count is a disclosure, not a place.
- **Group delete, and group membership editing.** Membership is
  `contacts.repoPath`; joining a group is what binding a contact already does,
  and deleting one is not durable.
- **Export in any other format.** JSON was considered and dropped: the app's own
  IPC shapes are not a stable public format, and publishing them as one would
  make every future domain change a breaking change for a file nobody promised.
- **A per-turn cost line in the group thread.** `group_messages` rows carry no
  session id and no link to `usage_events`; the only keys are `contactId` and a
  timestamp, which is the correlation §G6 rejected in the 1:1 case.
