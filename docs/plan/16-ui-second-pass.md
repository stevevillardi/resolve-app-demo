# Phase 16 — UI second pass

**Status:** Done — the list below was closed in [Phase 17](17-v1-wrap.md)
**Blueprint refs:** §10 (UI/UX component mapping — including the schedule picker it has always specified), §9 (GitHub)
**Depends on:** Phase 13 (the primitives this extends), Phase 14 (the capability fields the context panel now shows)
**Numbered 16** because 15 was already taken by
[15-deferred-capability-work.md](15-deferred-capability-work.md), which landed on `main` while
this was being planned.

## Why this exists

Phase 13 was the presentation pass and closed green. Using the built app afterwards surfaced a
different class of problem: not unfinished detail, but **decisions that had never been made.**

| Reported                                                  | What was actually wrong                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| "the status screen showed connected the entire time"      | `getGitHubStatus` answered from `existsSync()` on the token file. It never decrypted the token and never asked GitHub anything. |
| "persona and branches are a fixed width"                  | One line: `PaneBody` capped every detail pane at 672px and centred it under a full-bleed header.                                |
| "routine is a fixed width pane, doesn't match the others" | The same cap, but sitting between a full-bleed pane and a 896px one — three measures across seven panes.                        |
| "the forms are not the best layouts"                      | `Field` only ever emitted a stacked column, and the four `sm:` breakpoints in the app could never fire.                         |
| "no search on the github repo browse dialog"              | `github-client.ts` justifies its 100-repo cap by citing "a picker with a filter box". The filter box did not exist.             |
| "the home view should be a home button"                   | Home was the fall-through of Chats-with-nothing-selected, and nothing ever cleared the selection — so it became unreachable.    |
| "the cron schedule could use a picker"                    | Blueprint §10 has specified one since the beginning.                                                                            |
| "we should be using claude and codex svgs"                | Both backends were generic lucide glyphs, and two surfaces disagreed about which.                                               |

---

## The finding that reframed the layout work

`@container` appeared **nowhere** in the renderer. The only responsive classes were four `sm:`
variants — and `BrowserWindow.minWidth` is 940 while `sm` is 640, so every one of them was
**permanently on** and their `grid-cols-1` fallback had never rendered once. They also measured the
**window**, while the thing that actually varies is the workspace panel, which the user can drag
between 420px and full width.

So this is not "raise a max-width". The app had no working responsive system, and the fix is to
measure the pane. Verified in the built CSS rather than assumed: the variants compile to
`@container pane (min-width: 42rem | 48rem | 64rem)`.

---

## Landed

| Fix                          | What was wrong                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pane layout**              | `PaneBody` declares `@container/pane` and stops centring, so the body lines up under its header. `FieldGrid` packs fields into columns against the pane. Verified at 1100 and 1600 in both themes: fields collapse to one column at narrow and the skill list goes three across at wide — behaviour the old breakpoints could not produce at either size. |
| **`SegmentedControl` track** | Phase 13 sized the _segments_ to their labels, but every caller puts the control in a `flex flex-col` Field where the default stretch made the inline-flex track span the column anyway. `self-start`, the same workaround the ScopeChip beside it already carried. Only visible once panes got wide.                                                     |
| **`CheckRow`**               | The persona skill list was the fifth hand-rolled row style. Deliberately **not** a `ListRow` flag: ListRow's contract is one active row at a time, a checklist is many-of-N and needs `role="checkbox"`.                                                                                                                                                  |
| **GitHub status**            | `connected` keeps its honest meaning (a token is stored) and `tokenState` carries what GitHub last said. Sticky `rejected` across restarts; `unreachable` never persisted and never overriding a rejection. Verified at launch and on window focus — revoking happens in a browser, so the user leaves and comes back.                                    |
| **Repo filter**              | Reuses `scoreCommand`'s ranking rather than a second implementation; it already splits on `/`. Names the 100-repo cap, because exactly 100 rows is indistinguishable from 100-of-400.                                                                                                                                                                     |
| **Home section**             | Its own nav item, first in the rail, no list panel, and the launch section. Chats-with-nothing-selected keeps the live half and loses the spend line. Home gains branches waiting to be merged — the one state in this app that silently accumulates.                                                                                                     |
| **Brand marks**              | Claude, Codex and OpenAI vendored the way `GithubMark` already was. Still muted ink: the badge sits beside the scope chips and two saturated logos would out-shout the permissions that are the point of the row.                                                                                                                                         |
| **Schedule picker**          | The expression **is** the value — the picker holds no state, reads the string on render and writes one back. `parseCron` returning null _is_ Custom mode, so an expression it cannot draw survives being opened. node-cron stays in main.                                                                                                                 |
| Composer measure             | Full-bleed against a `max-w-4xl` message column, so the field you reply in was wider than what you were replying to.                                                                                                                                                                                                                                      |
| Bound contacts               | A full absolute path against a raw `backendSessionId`. Now repo name, isolation, and a way to go there.                                                                                                                                                                                                                                                   |
| Routine header               | Printed the full absolute repo path — the defect Phase 13 fixed in ThreadView and missed here.                                                                                                                                                                                                                                                            |

### Found while doing it

- **`contactName` already contains the repo**, so appending `repoName()` prints it twice. Phase 13
  fixed this in `BranchDetail`'s subtitle; it was reintroduced two feet away on the Home screen and
  caught by the sweep.
- **A test that was wrong before the code was.** `repo-filter.test.ts` claimed a name starting with
  the query outranks one merely containing it. `scoreCommand` splits on hyphens too, so both are
  word-start matches and tie. The mistake is recorded next to the corrected assertion.
- **The merge with `main` had one real conflict** and the obvious resolution would have been wrong.
  Phase 14 put `capabilitiesFor` inside `startTurn`; Phase 13 had extracted that block into
  `buildSessionSpec`. Keeping both compiles and passes — the turn would send the repository's
  instructions and skills while the panel whose entire job is "what will this turn send" would not
  know they existed. Nothing would fail. See the merge commit.

---

## Still open — closed in Phase 17

- ~~Group thread view at both widths~~ — reviewed in the Phase 17 sweep.
- ~~`BreakdownRows` fixed `w-28`/`w-16` columns~~ — the name column now shares the flexible width
  with the bar (1:2); the numeric columns stay fixed on purpose, tabular figures want a constant
  column.
- ~~The `ConfirmDeleteDialog` call sites read side by side~~ — done; the persona dialog's refusal
  now names the bound contacts in a consequence band and the skill dialogs moved their affected
  personas into the same band, one visual grammar across all of them.
- ~~`DeviceCodeDisplay`~~ — gained the countdown both device flows always knew (`expiresAt`),
  ticking to an honest expired state.

## Notes for whoever picks this up

- **Container queries need a declared container.** `PaneBody` declares `@container/pane`;
  `SkillLibraryView` opts out of PaneBody and so declares its own. A `@2xl/pane:` class inside
  neither silently does nothing.
- **The repo filter is not in the sweep.** The repo step sits behind the persona step and a live
  GitHub token, so `npm run screens` photographs step 1 of that dialog only. Covered by unit tests
  instead — an honest trade, not an oversight.
- Adding a `Section` member is a compile error until `ListPanel`'s `PANEL` record handles it. That
  is the feature; do not loosen it to a `Partial`.
- Base UI writes boolean state as a **valueless** `data-active`, so an E2E assertion has to check
  presence rather than compare against `"true"`.
