# Phase 26 — Scale: findability, the cost of a list, and the links between screens

## Context

Switchboard is finished for the profile it was built against: three personas,
three contacts, two repositories. Every rail has a search box, every empty state
names the next action, and the usage dashboard has real range/metric/source
facets.

It had never been used at the shape a power user reaches — a dozen repositories,
thirty contacts, months of turns — and at that shape three separate things stop
working. The request that opened this phase named one of them ("no way to filter
contacts by repo"); the other two were found looking for things shaped like it.

**Numbered 26 because 24 and 25 are taken.** `phase-24-approval-mode` is a
sibling worktree, and Phase 25 shipped the running-turn surfaces whose comments
are already on main (`run-view.ts`, `useNow.ts`, `tray-menu.ts`, `RunRow.tsx`).
Worth recording separately: **the tracker stops at 23 while the code for 24 and
25 is on main**, which is the document lying about the build in the way
`00-progress.md`'s own instructions warn about. Not fixed here — this phase
cannot invent the content of two others — but it is the first thing the next
person should close.

**The design decisions from this phase live in `docs/ARCHITECTURE.md`**, not
here — the facet semantics, the contact-naming rule and its accepted
consequence, where a rail's filter lives, why filtering stays in the renderer
while aggregates move to SQL, and the three indexing rules. This file is the
build log behind them: what was wrong, what was measured, and what was
deliberately left undone.

## §A — Findability

### A1 — the name a user typed was invisible

Every list rendered `persona?.name ?? contact.displayName`, so the persona always
won. The seeded demo shows the cost: the Chats rail drew two rows both reading
"Code Reviewer", the Routines rail drew two more, and the command palette — the
surface for finding one thing among many — could not tell any of them apart.

`displayName` was already right in the data. NOT NULL, defaulting to
`derivedName()` ("Code Reviewer · checkout-service"), asked for at creation
(§G4), changed by `contacts.rename`, and already read by the delete dialog and
the Markdown export. The lists disagreeing with those was the bug.

One helper, for the reason `groupName` is one: every reader that keeps writing
the fallback inline is a place a rename silently has no effect.

**Three callers deliberately keep the persona name.** `MentionPicker` and the
group composer's `@` insertion build a token `parseMention` resolves _against the
persona name_ — retitling those breaks routing. `AvatarColorSwatch` draws the
persona's own face, and that is where persona identity stays live on the row.

**Known limit.** `display_name` is a stored string, not a nullable override like
`groups.name`, so renaming a persona no longer retitles the contacts bound to it.
Before this the row tracked the persona and could not show a typed name at all;
now it shows the typed name and does not track. "Rename" has to mean something,
and the avatar still moves with the persona. Revisit if anyone renames a persona
and expects the fleet to follow.

### A2 — facet chips

A row of chips under each rail's search box. **OR within a facet, AND across
facets.** The other two readings fail concretely: AND everywhere makes a second
repository empty the list, OR everywhere makes every chip widen it.

Chosen over a `repo:` search syntax — invisible until documented, needs a parser
and an error state for a typo, and shows nothing about what is currently applied.

**`FacetSpec` and `FacetValues` are separate on purpose.** `ListPanel` owns the
header and knows what the options _are_; each list owns its row type and knows
what a row _matches_ — only the routines list can say a routine's repo is its
contact's. Fusing them makes the bar generic over a row type it never touches.

Matching delegates to `scoreCommand`, so `persona-filter.ts` and `repo-filter.ts`
stop being the only ranked filters in the app. **The score is discarded**: Chats
keeps recency (Phase 20) and the rest keep alphabetical, because re-sorting by
relevance makes rows jump as someone types and gives ⌥↑/⌥↓ a second definition of
order to disagree with.

Facets are derived from live data. A one-repository profile sees no Repo chip; a
Claude-only profile sees no Backend chip; a persona nobody has bound is not
offered, because selecting it could only ever empty the list. `repoFacet`
de-duplicates on the **full path**, so two checkouts both called `api` stay two
options, labelled by their parent — the collision this app is one `git clone`
away from.

Two existing rules survive with their reasoning intact. Hidden groups still
surface under a **search** and deliberately not under a **facet**: typing a name
asks for one thing you have in mind, ticking a chip narrows a list, and a hidden
row reappearing because you narrowed would undo the hiding unasked.

`minOptions` is the one rule that changed after looking at the running app — see
"Found by driving" below.

### A3 — rows that search what they show

The Routines rail searched `prompt` and `schedule` while displaying the persona
name, so typing the one thing on screen matched nothing. It also rendered raw
cron in its trailing slot while the editor two panes away had shown English since
Phase 16.

`shortSchedule` is `describeSchedule` at chip length. **It hands back an
expression it cannot parse, verbatim**, because `parseCron` returning null _is_
Custom mode and inventing prose would print a guess as a fact. One exception:
`stepHours` reads the every-N-hours form, because that is the seeded demo's own
routine and the literal string in the complaint. It lives in the display path
only — widening `parseCron` would make the picker draw a frequency it has no
control for.

### A4 — Usage had no search

`ListPanel` gave every other section a box and gave this one nothing — the only
rail whose length grows on both axes at once, one row per persona plus one per
repository. No facets: the dashboard beside it already owns range, measure and
source, and a second set of controls would raise the question of which wins.

### A5 — a failed read looked like an empty install

Every list hook but `useRepos` defaulted a failed query to `[]`, so a broken IPC
call rendered "No personas yet" — advice to create something, in answer to a
question the app could not ask.

A third `EmptyState` variant, in the warning register: nothing was damaged, a
read did not come back. `retry: 1` rather than TanStack's default three — there
is no network here, so backoff only delays the moment the list may say so.

**`refetchOnWindowFocus` is deliberately left on**, and that is now written down.
It looks like pure cost against a SQLite file, and it is the safety net under a
gap Phase 20 documented: `contacts` and `groups` have no push channel, so a write
from outside this renderer is only noticed on focus.

Worth knowing: a _background_ refetch that fails keeps the last good data, so the
list goes on rendering rows and never reaches this branch. That is correct, and
it means this state is only ever the first load — which is exactly the case that
used to lie.

## §B — The cost of drawing a list

Three reads whose cost grew with the thing a fleet accumulates.

**B1 — `usage.list` was the whole table.** The Chats rail and the Usage rail both
answered "what has this cost" by fetching every usage row ever written and
scanning it once per row drawn; `UsageScopeList` did it inside an unmemoized
`costFor`. `usage.summaries` is one `GROUP BY contact_id`, modelled on
`unreadCounts()`. Grouped by contact and nothing else, because everything else
composes: a group's figure is its members' summed, a persona's is its contacts'.

This is a **second implementation of a spend calculation**, and the failure mode
is not a crash — it is `$12.34` where the other says `$12.34+`. So the rules moved
to `src/shared/usage-summary.ts` and the test runs both over the same rows and
compares. That move is also what keeps the boundary intact: the test needs a real
database, so it lives in the main project, and a main-process test may not import
a renderer module. Two rules survive into SQL rather than being re-argued there —
`SUM(cost_usd)` over all-NULL returns NULL (unknown, never free, hence no
COALESCE), and `COUNT(cached_input_tokens)` tells absent from zero.

**B2 — the preview queries read every message row.** Both ran on every render
path of the primary screen and wanted one row per conversation. Now driven by
`contacts` / `groups`, so it is one index seek per conversation instead of a full
scan plus a sort.

**B3 — branches read git serially.** `for … await` over `listGroups()`, so twenty
repositories meant twenty round trips before the panel painted. Now bounded
concurrency, and **bounded rather than a bare `Promise.all`** because `branchesIn`
is already unbounded within a repo: twenty repositories of five branches would ask
the OS for three hundred concurrent subprocesses.

**B4 — migration 0024**, three `CREATE INDEX`. `contacts.persona_template_id` had
been a foreign key since 0002 with no index on the referencing side, and the two
columns 0008 denormalised onto `usage_events` so spend could be grouped by them
were never indexed. Paired with `timestamp` rather than alone, because every
usage read is inside a range — measured with `EXPLAIN QUERY PLAN`:

```
before  SCAN usage_events + USE TEMP B-TREE FOR GROUP BY
after   SCAN usage_events USING INDEX usage_events_repo_timestamp_idx
```

## §C — Cross-navigation

The app models a tight graph and rendered it as dead ends.
`PersonaDetailPanel` had the only link and proved the pattern. Facets are what
made the rest possible: "show me X's conversations" needs a destination that can
express X.

**The filter moved into the store, keyed by section.** It was `useState` in
`ListPanel`, cleared on every section change — right while one query string was
shared by all sections, unnecessary once each has its own. `showIn` could not work
without it: a link that narrows a section the user is not currently on cannot be
served by state that unmounts with that section. **Not persisted**, alongside
`section` itself — relaunching into a rail silently narrowed by last week's chip
is the no-visible-cause failure `noMatchDescription` exists to prevent.

`showIn` is one action rather than two calls, because the symptom of doing half
of it — navigated but not narrowed — looks exactly like the feature being broken.
It **replaces** the target's filter rather than merging, because the caller is
stating the whole question.

Links added: usage scope → its conversations; group row → its branches; routine →
its conversation; Home's three fleet counts → the three sections that hold them.

## Migration

**0024** — three `CREATE INDEX`, nothing backfilled, no column moved. Covered by
`upgrade.test.ts` with no new fixture, via the journal-prefix harness.

## Found by driving the built app

Three things every test passed through, and the reason a screenshot is not
optional:

- **The Unread chip never rendered.** `FACET_MIN_OPTIONS` hides a facet with
  fewer than two options — right for facets that partition by identity, wrong for
  a state facet, where "Unread" alone still splits the list. The test covering it
  asserted the old behaviour, so it passed while the feature was missing: a test
  written from the rule in the code rather than from the claim. `minOptions` is
  the fix and the test now states the claim.
- **`0 star-slash-4 star star star` still read as cron** — the literal string in
  the original complaint. Hence `stepHours`.
- **Names truncate on the distinguishing half** in a 240px rail. The full string
  is now the `title`.

## Verification

- `npm run build` — typecheck + unit suite + bundle. **1,979 passing**.
- `npx playwright test --project=e2e` — **92 passing**. Worth recording how that
  number got there: for most of this branch's life it was 91 with one failure in
  `guide.spec.ts`, which was diagnosed as pre-existing by building main in a
  throwaway worktree and running the same spec, where it failed the same test
  with the same 7/1 split. Main has since fixed it independently, which confirms
  the diagnosis. The underlying hazard stands and is worth knowing: the guide
  ticks its steps off live auth state, and the throwaway profile cannot isolate
  the macOS Keychain — the caveat already recorded for Claude Code login reaches
  GitHub too.
- `npm run screens` — 133 screens, both themes, both widths.
- Driven by hand at 1500×950 on the seeded profile: chips on Chats, the repo chip
  narrowing to one contact and its group, "Every 4h" and "Daily 09:00" in
  Routines, a search box on Usage, and the error state photographed by forcing
  its branch.

**The strongest single check** was not an assertion. The Usage dashboard's totals
are byte-identical to the pre-phase screenshots — $2.15+, $1.34+, $0.81, $1.92,
$0.23+ — which is the SQL rollup agreeing with the arithmetic it replaced, in the
real app, on real seeded data.

Mutation checks, each failing exactly its own test: AND-within and OR-across in
`matchesFacets`; keeping empty facet arrays in `toggleFacetValue`; de-duplicating
repos by folder name; offering unbound personas; `COALESCE` on the cost sum;
sending cached tokens unconditionally; treating null as zero while combining;
dropping the cross-repo sort in branches; replacing `mapLimit` with an uncapped
`Promise.all`; reversing the preview sort and rewriting it as `GROUP BY … HAVING
MAX(timestamp)`.

**One mutation deliberately did not fail, and that is recorded rather than
hidden.** Deleting `m.rowid DESC` from the preview subquery changes nothing
today: it rides `messages_contact_timestamp_idx`, and a descending walk of
`(contact_id, timestamp)` already yields descending rowid inside a tie. The clause
stays — that is a property of the access path, not of the query — but the comment
now says so instead of implying a guard that is doing work.

## Not done, deliberately

- **Bulk / multi-select.** Deleting ten stale contacts is still ten confirm
  dialogs. Scoped out by the user at planning time.
- **Keyboard coverage past §G1.** ⌥↑/⌥↓ still work only in Chats; Personas,
  Skills, Routines and Branches have no arrow navigation, and there is no ⌘1–7
  for sections. Same decision.
- **Server-side filtering.** Every filter here is renderer-side, on purpose:
  `ConversationList` derives its ⌥↑/⌥↓ order from the arrays it renders, and
  moving the predicate into SQL would move that order with it. Revisit when a
  profile is large enough that `contacts.list` itself is the cost — at which
  point `usage-events.ts`'s `$dynamic()` is the pattern to copy.
- **A general cron translator.** `stepHours` covers one shape because one shape
  was on screen. Guessing at the rest is how a display starts asserting a
  schedule the app does not run.
