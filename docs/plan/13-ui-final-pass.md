# Phase 13 — UI final pass

**Status:** In progress
**Blueprint refs:** §10 (UI/UX component mapping), §16 (the three journeys this has to hold up under)
**Depends on:** Phase 6 (real messaging data), Phase 2 (the visual language this extends)
**Relationship to Phase 11:** Phase 11 is the *integration* pass — run all three journeys end to
end and fix what breaks between phases. This one is the *presentation* pass and runs earlier,
because the seams it fixes are cheapest to fix before Phases 7–10 add four more screens on top of
them.

## Why this exists

Phase 2's overhaul gave the app a considered visual language — three-pane console shell, oklch
palette with recorded contrast and CVD reasoning, Inter + JetBrains Mono with a "mono = machine
identifier" rule, `ScopeChip` as the signature element. Phase 6 then made the data real.

What was missing was the last stretch between *working* and *finished*: places where the app was
correct but read as unfinished. A first sweep landed on `main` (`cfa4924`, `4a70ebd`, `2752f02`)
and is recorded under "Done" below. This doc carries the rest.

The organising idea is unchanged and not up for revision here: **this is a console for a fleet of
scoped workers.** Palette, type pairing and the three-pane concept stay as Phase 2 set them.

---

## Done

Landed on `main` before this doc was written; recorded so the reasoning isn't lost.

| Fix | What was wrong |
|---|---|
| Overlay motion | `dialog`, `popover`, `tooltip`, `dropdown-menu`, `select` styled their entrance with `animate-in` / `zoom-in-95` / `slide-in-from-*` — utilities from `tw-animate-css`, which is **not a dependency and never imported**. Every overlay in the app snapped in with no transition. Rewritten onto Base UI's `data-starting-style` / `data-ending-style`, the idiom `sheet.tsx` already used correctly. No new dependency. |
| Reduced motion | Only the launch splash honoured `prefers-reduced-motion`. Now global, collapsing durations to ~0 rather than `animation: none` — Base UI keeps a popup mounted until its exit transition ends, so removing the transition strands closed overlays on screen. |
| Search field alignment | The icon was `absolute top-1/2` inside a wrapper carrying `pb-2.5`, so it centred on the padded box, not the input. Rebuilt on the already-vendored, previously unused `InputGroup`. |
| Disabled buttons | `disabled:opacity-50` alone: against the true-black dark canvas a half-opacity brand blue still reads as live, so a disabled **Save** looked clickable. Desaturates as well as fades now. |
| Skill editor | A fixed `rows={14}` box inside a narrow scrolling column left a third of the pane empty. It is the app's only long-form writing surface; it now claims the full pane height, with metadata in a band above and the affected personas pinned in a footer strip. |
| Pane primitives | `PaneHeader`, `PaneBody`, `Field`, `Section`, `ListRow` extracted to `components/common/`. Four workspace views had each hand-rolled the same chrome and drifted — two on `gap-5`, two on `gap-6`, differing measures and focus rings — so the rhythm changed as you moved between sections. |
| Command palette | ⌘K over conversations, personas, skills, routines, sections and actions. Ranking is pure and tested (`lib/command-palette.ts`, 13 tests); rows carry `ScopeChip`s so the palette isn't the one place a persona's permissions go invisible. Built on the already-vendored `cmdk`. |
| Run indicator | Phase 6 shipped `runs.list`, but nothing in the shell said the fleet was working. Now a mono count in the nav rail and a marker on the conversation row — a run outlives the thread view, since switching conversations unmounts the thread but not the turn. |
| Error boundary | A render throw unmounted the whole tree and left a blank Electron window — no message, no way back, and no devtools in a packaged app. `ErrorBoundary` at the root of `main.tsx`, outside the providers so a throw from one of *them* is caught too. Verified by forcing `personas.list` to return a non-array. |

---

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
  render as `$0.00` (blueprint §3 — Codex reports no dollar figure).
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

- [ ] Launching with no conversation selected lands on something useful, not an empty pane.
- [ ] Every list row in the app comes from `ListRow`; no section hand-rolls its own.
- [ ] All five sections have an empty state that names the next action, verified with an empty
      database and with a non-matching search.
- [ ] A throw inside one pane leaves the nav rail and list panel usable.
- [ ] Every screen re-checked in both themes at a narrow and a wide window.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green; new pure logic has tests.

## Notes for whoever picks this up

- **Iteration loop.** `npx electron-vite dev` (note: `--rendererOnly` skips *rebuilding* main and
  preload, it does not stop Electron launching), then drive `http://localhost:5173` with Playwright.
  The renderer boots through `auth.getStatus` with no fallback, so stub `window.api` and click the
  splash's **Try again** — that retry path is how you get in. Stash the stub in `localStorage` so it
  survives the reloads a failed HMR update forces.
- Screenshot before *and* after every extraction. Items 2 and 4 are meant to be visually neutral,
  and that is only checkable by comparison.
- `lucide-react` v1 has no brand marks — `Github` comes from `components/github/GithubMark.tsx`.
  This has now been rediscovered twice; the compiler catches it, but expect it.
- A `.tsx` file that exports a non-component breaks React Fast Refresh, which is why `NAV_ITEMS`
  lives in `lib/nav-items.ts`.
- The renderer Vitest project matches `src/renderer/**/*.test.ts` — **`.tsx` is not matched**, and
  there is no `@testing-library/react`. Pure functions in `lib/` are the only renderer logic that
  can be covered; everything else is verified by screenshot. Push logic worth testing out of
  components on purpose, the way `lib/stream.ts` and `lib/command-palette.ts` do.
