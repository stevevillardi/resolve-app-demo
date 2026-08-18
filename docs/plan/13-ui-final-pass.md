# Phase 13 — UI final pass

**Status:** Done — every acceptance check verified, including the pane-boundary and empty-state audits.
**Blueprint refs:** §10 (UI/UX component mapping), §16 (the three journeys this has to hold up under)
**Depends on:** Phase 6 (real messaging data), Phase 2 (the visual language this extends)
**Relationship to Phase 11:** Phase 11 is the _integration_ pass — run all three journeys end to
end and fix what breaks between phases. This one is the _presentation_ pass and runs earlier,
because the seams it fixes are cheapest to fix before Phases 7–10 add four more screens on top of
them.

## Why this exists

Phase 2's overhaul gave the app a considered visual language — three-pane console shell, oklch
palette with recorded contrast and CVD reasoning, Inter + JetBrains Mono with a "mono = machine
identifier" rule, `ScopeChip` as the signature element. Phase 6 then made the data real.

What was missing was the last stretch between _working_ and _finished_: places where the app was
correct but read as unfinished. A first sweep landed on `main` (`cfa4924`, `4a70ebd`, `2752f02`)
and is recorded under "Done" below. This doc carries the rest.

The organising idea is unchanged and not up for revision here: **this is a console for a fleet of
scoped workers.** Palette, type pairing and the three-pane concept stay as Phase 2 set them.

---

## Done

Landed on `main` before this doc was written; recorded so the reasoning isn't lost.

| Fix                    | What was wrong                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overlay motion         | `dialog`, `popover`, `tooltip`, `dropdown-menu`, `select` styled their entrance with `animate-in` / `zoom-in-95` / `slide-in-from-*` — utilities from `tw-animate-css`, which is **not a dependency and never imported**. Every overlay in the app snapped in with no transition. Rewritten onto Base UI's `data-starting-style` / `data-ending-style`, the idiom `sheet.tsx` already used correctly. No new dependency. |
| Reduced motion         | Only the launch splash honoured `prefers-reduced-motion`. Now global, collapsing durations to ~0 rather than `animation: none` — Base UI keeps a popup mounted until its exit transition ends, so removing the transition strands closed overlays on screen.                                                                                                                                                             |
| Search field alignment | The icon was `absolute top-1/2` inside a wrapper carrying `pb-2.5`, so it centred on the padded box, not the input. Rebuilt on the already-vendored, previously unused `InputGroup`.                                                                                                                                                                                                                                     |
| Disabled buttons       | `disabled:opacity-50` alone: against the true-black dark canvas a half-opacity brand blue still reads as live, so a disabled **Save** looked clickable. Desaturates as well as fades now.                                                                                                                                                                                                                                |
| Skill editor           | A fixed `rows={14}` box inside a narrow scrolling column left a third of the pane empty. It is the app's only long-form writing surface; it now claims the full pane height, with metadata in a band above and the affected personas pinned in a footer strip.                                                                                                                                                           |
| Pane primitives        | `PaneHeader`, `PaneBody`, `Field`, `Section`, `ListRow` extracted to `components/common/`. Four workspace views had each hand-rolled the same chrome and drifted — two on `gap-5`, two on `gap-6`, differing measures and focus rings — so the rhythm changed as you moved between sections.                                                                                                                             |
| Command palette        | ⌘K over conversations, personas, skills, routines, sections and actions. Ranking is pure and tested (`lib/command-palette.ts`, 13 tests); rows carry `ScopeChip`s so the palette isn't the one place a persona's permissions go invisible. Built on the already-vendored `cmdk`.                                                                                                                                         |
| Run indicator          | Phase 6 shipped `runs.list`, but nothing in the shell said the fleet was working. Now a mono count in the nav rail and a marker on the conversation row — a run outlives the thread view, since switching conversations unmounts the thread but not the turn.                                                                                                                                                            |
| Error boundary         | A render throw unmounted the whole tree and left a blank Electron window — no message, no way back, and no devtools in a packaged app. `ErrorBoundary` at the root of `main.tsx`, outside the providers so a throw from one of _them_ is caught too. Verified by forcing `personas.list` to return a non-array.                                                                                                          |

---

## The screenshot sweep, and what it found

`npm run screens` builds the app and walks it: two profiles (seeded and fresh), both themes, 1100
and 1600 wide, every section in both its list and selected states, plus the command palette, the
new-contact dialog and a search that matches nothing. ~105 PNGs into `screens/` (was `test-results/screens/` until Phase 23 moved it out of the directory Playwright wipes).

It lives in `e2e/screenshots/` so it can use `e2e/fixtures.ts`, and runs as its own Playwright
**project** so it can never join `npm run test:e2e` — it asserts almost nothing on purpose. There
are no golden baselines: relative timestamps and the live clock would make them permanently red,
and a permanently-red check is one nobody reads. The comparison is a human diffing the directory
before a change against the same directory after.

`e2e/screenshots/showcase.ts` seeds it. **No turn is ever run**, so the sweep bills nothing —
messages, group messages and usage rows go straight into the profile's SQLite, the pattern
`e2e/usage.spec.ts` already established. It creates a real `git worktree` with a commit, because
otherwise the Branches section photographs its empty state and the pane most in need of review is
the one screen the sweep misses.

### What it found

Beyond the items already scoped below:

- [x] **The thread header prints the full absolute repo path** and it consumes the entire header —
      `/private/var/folders/6d/0rkvg…/billing-api`. The list rows already show `repoName()`; the
      header should too, with the full path in a tooltip.
- [x] **A short thread sits at the top of the pane**, leaving ~800px between the last message and
      the composer. Thread content should be bottom-aligned.
- [x] **`BranchDetail` has no header at all**, so its title floats in the middle of an otherwise
      empty pane and the header rule that runs unbroken across every other screen just stops at the
      pane divider. Its actions sit at the bottom of the scrolling body rather than in a header.
      Confirms item 4 below and then some.
- [x] **`BranchDetail`'s subtitle repeats the repo name twice** — "checkout-service · Refactor
      Buddy · checkout-service · 88c574d" — because `contactName` already contains it.
- [x] **The five "nothing selected" panes have no bottom border on their drag strip**, so the same
      rule stops dead at the divider there too. Visible on every launch.
- [x] **`SegmentedControl` confirmed**: on the usage dashboard "All" is rendered as wide as
      "Summaries", and "All" as wide as "30 days". Every segment takes the longest label's width,
      so the active thumb is routinely two or three times wider than the word inside it.
- [x] `NewContactFlow` is in better shape than the brief assumed — it already has a step indicator,
      scope chips and a footer tray. Its selectable rows are still a fourth hand-rolled row style.

## Scope

### 1. The workspace home view — the largest remaining gap

With no conversation selected, roughly 70% of the window is a centred `EmptyState` in an otherwise
empty pane. On a 1440px window that is about 1000×800 of nothing, and it is the **first thing seen
on every launch**, since selection is deliberately not persisted (`useUiStore` `partialize`).

Replace the empty state in `WorkspaceView`'s fall-through branch with a real home view. It has live
data behind it as of Phase 6 and needs no new procedures:

- **Active runs** — `useActiveRuns()`. What is working right now, on which repo, for how long, with
  a stop affordance. This is the console's reason to exist and currently appears nowhere at rest.
- **Recent activity** — `messages.previews`, already fetched by `ConversationList`. Latest turn per
  contact, newest first, each row jumping into its thread.
- **Spend at a glance** — `usage.list`, already fetched. Small, honest: `costUsd: null` must never
  render as `$0.00`. (This used to read "blueprint §3 — Codex reports no dollar figure", which
  stopped being true in Phase 5: `pricing.ts` computes one locally and marks it
  `costSource: 'computed'`. `costUsd: null` now means exactly one thing — the model has no row in
  the price table.)
- **Getting started** — only when there are genuinely no contacts. The current empty state is right
  for a fresh install and wrong for every launch after it; that is the actual defect.

Keep it quiet. This is a resting screen, not a dashboard — the Usage section owns charts.

### 2. Remaining list rows

`RoutineList` and `UsageScopeList` still hand-roll the row button that `ListRow` now owns. Same
extraction as `PersonaList` / `SkillList`; behaviour-neutral, verify by screenshot.

### 3. Empty and error states, audited rather than assumed

Every section has an empty state; they have not been checked against each other. Walk all five with
an empty database and with a search that matches nothing, and confirm each says what to do next
rather than only what is absent. An empty screen is an invitation to act (Phase 11 §4 also calls for
this — do the presentation half here, leave the integration half there).

Also widen the per-view failure story: the root `ErrorBoundary` guarantees the window is never
blank, but a throw in one pane currently takes the whole shell with it. Per-section boundaries that
keep the nav rail and list panel alive are the refinement.

### 4. Density and rhythm sweep

With the primitives in place, one pass over what they revealed:

- Persona list rows change height depending on scope-chip wrapping (`workspace_write` + `open_pr`
  wrap to two lines where `read_only` pairs do not), so the list has a ragged rhythm.
- Type scale is hand-tuned per component — `text-[13px]`, `text-[11px]`, `text-[12.5px]`,
  `text-[15px]` all appear. Not necessarily wrong at desktop density, but it should be a decided
  scale rather than an accumulated one.
- `ui/card.tsx`, `ui/tabs.tsx`, `ui/badge.tsx`, `ui/avatar.tsx` are vendored and imported by nothing.
  Either use them or delete them; a primitive nobody uses is a decision nobody made.

### 5. Keyboard model

⌘K and ⌘B now exist and don't collide. Decide whether the set stops there. Candidates, in the order
they'd earn their keep: `/` to focus the list search, `⌘\` to toggle the list panel, `esc` to clear
a search. Document whatever is chosen somewhere discoverable — an undiscoverable shortcut is not a
feature.

## Explicitly out of scope

- Palette, type pairing, and the three-pane concept. Phase 2 recorded the reasoning for each,
  including contrast and CVD validation; re-opening them is a different phase with a different
  argument.
- Anything behind data that doesn't exist yet. `GroupThreadView` (Phase 7), `RoutineEditor`
  (Phase 8) and `UsageDashboard` (Phase 10) stay mock-fed — polish their presentation, don't wire
  them.
- New product surface. This phase changes how things read, not what the app does.

## Acceptance checks

- [x] Launching with no conversation selected lands on something useful, not an empty pane.
      `WorkspaceHome` — running turns, recent conversations, a week's spend.
- [x] Every list row in the app comes from `ListRow`; no section hand-rolls its own. Checkable
      mechanically now: every row carries `data-testid="list-row"`.
- [x] All sections have an empty state that names the next action, verified with an empty database
      and with a non-matching search. Three gaps closed; one reported gap turned out not to exist.
- [x] A throw inside one pane leaves the nav rail and list panel usable. Verified by making
      `PersonaList` throw and running the sweep.
- [x] Every screen re-checked in both themes at a narrow and a wide window — that is what
      `npm run screens` is.
- [x] `npm run lint`, `npm run typecheck`, `npm test` green; new pure logic has tests.
      973 unit tests, 47 E2E.

## Beyond the original scope

Landed here because the sweep or the work surfaced them:

| Fix                    | What was wrong                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type scale             | 76 arbitrary `text-[Npx]` values interleaved with `text-xs`/`text-sm`. Five named `@theme` steps; font-size only, no paired line-height, so the 32-file rename stays provably neutral.                                                                                                            |
| `SegmentedControl`     | Every segment `flex-1`, so all took the longest label's width — "All" as wide as "Summaries". Segments size to content; the thumb is measured off the selected label rather than computed, because the old arithmetic only worked while they were equal.                                          |
| **NUL bytes**          | `BranchDetail.tsx` joined a React key with a literal `\0`. A file containing one is _binary_ to grep, silently, so it vanishes from every grep-based sweep — which is how the type-scale codemod missed it. `find src -name '*.tsx' -exec file {} + \| grep -v text` finds this class of problem. |
| Contact management     | `contacts.delete` had existed since Phase 12 and nothing called it; renaming was impossible. `contacts.update` takes `{ id, displayName }` only — every other column is load-bearing.                                                                                                             |
| Context panel          | Blueprint §5 had no surface. `contacts.context` returns the literal string both adapters receive, resolved in main because the renderer cannot see `contextForRepo`'s filtering, `siblingBranchesFor`'s disk reads, or the headings in `adapters/context.ts`.                                     |
| Thread header          | Printed the full absolute repo path across the whole header. Repo name now, path on hover.                                                                                                                                                                                                        |
| Thread alignment       | A short thread sat at the top with ~800px to the composer. `min-h-full justify-end`.                                                                                                                                                                                                              |
| Dead primitives        | `avatar`, `badge`, `card`, `tabs` — zero importers, deleted.                                                                                                                                                                                                                                      |
| Pre-existing red suite | Two E2E specs had been failing on `main` since 8ca3dec: migration 0009 made `mcpServerIds` required and their persona drafts were never updated.                                                                                                                                                  |

## Found after this doc was closed

Two defects reported from using the built app, fixed on the same branch.

| Fix                                            | What was wrong                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The type scale broke every chip it touched** | `cn()` is `twMerge(clsx(…))`, and tailwind-merge resolves conflicts by _group_. It cannot tell whether an unrecognised `text-*` is a size or a colour, so it filed `text-meta` in the colour group and **deleted it** whenever a colour followed — `cn('… text-meta …', 'text-scope-safe')` returned only the colour. Every `ScopeChip` in the app rendered at the body's 16px instead of 11px, larger than the 13px row title above it, with no class in the DOM to explain why. Caused by this phase's own type-scale commit: `text-[11px]` carries a unit so tailwind-merge could always tell it was a length, and a bare token name cannot be guessed. `extendTailwindMerge` in `lib/utils.ts` now declares all five, and **any new `--text-*` has to be added there in the same commit** — there is no build-time check for it. Fixing it also closed the "ragged rhythm" item above, since both chips now fit on one line and persona rows stop changing height with scope-name length. |
| Repo list failure                              | The picker replaced main's error with "Check your connection and try again", which was wrong for two of the three failures it actually sees. It now shows `describeGitHubError`'s own words plus **Try again** and **Reconnect**, and no longer retries three times first. This uncovered the larger defect this phase does not fix: `getGitHubStatus` reports `connected: true` from a token _file existing_, so a revoked token shows a green dot indefinitely — [Phase 16](16-ui-second-pass.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**A test with no teeth, worth recording.** The first check written for the type-scale bug was a DOM
audit walking every rendered element for a size token whose computed size disagreed. It passed
against the unfixed build — the failure _removes the class_, so there is nothing in the DOM to find.
It was replaced by assertions on the string `cn()` returns (`lib/utils.test.ts`), which do fail
against the unfixed code. Same trap as the rename test earlier in this phase: a check that cannot
observe the failure it is named after is not a check.

## Notes for whoever picks this up

- **Iteration loop.** `npm run screens` builds the app and photographs every screen into
  `screens/` — two profiles, both themes, two widths, ~130 PNGs plus an `index.html` contact sheet. Its own Playwright
  project, so it never joins `npm run test:e2e`. Compare the directory before a change against the
  same directory after; there are deliberately no golden baselines, because relative timestamps and
  the live clock would make them permanently red.
  (The older recipe — `npx electron-vite dev` plus a stubbed `window.api` — still works and is
  faster for a tight loop, but it drives fake data.)
- `e2e/screenshots/showcase.ts` seeds the sweep and **never starts a turn**, so it bills nothing.
  If a section photographs its empty state, seed it there rather than accepting the gap: the pane
  most in need of review is the one the sweep is not looking at, which is exactly how `BranchDetail`
  stayed the worst screen in the app for three phases.
- An empty list still has a button in its body — the empty state's call to action. Clicking it opens
  a dialog whose backdrop swallows every later click, and the failure surfaces as a timeout several
  steps away. `selectFirstRow` in the sweep guards against it; this cost time twice.
- Screenshot before _and_ after every extraction. Items 2 and 4 are meant to be visually neutral,
  and that is only checkable by comparison.
- `lucide-react` v1 has no brand marks — `Github` comes from `components/github/GithubMark.tsx`.
  This has now been rediscovered twice; the compiler catches it, but expect it.
- A `.tsx` file that exports a non-component breaks React Fast Refresh, which is why `NAV_ITEMS`
  lives in `lib/nav-items.ts`.
- The renderer Vitest project matches `src/renderer/**/*.test.ts` — **`.tsx` is not matched**, and
  there is no `@testing-library/react`. Pure functions in `lib/` are the only renderer logic that
  can be covered; everything else is verified by screenshot. Push logic worth testing out of
  components on purpose, the way `lib/stream.ts` and `lib/command-palette.ts` do.
