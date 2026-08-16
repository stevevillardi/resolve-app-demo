# Phase 10 — Usage & Cost Dashboard

**Status:** Done — all six acceptance checks verified, the live pass outstanding (see "Left for the live pass")
**Blueprint refs:** §4 (UsageEvent), §10 (UsageBadge/UsageDashboard), §14 (open items #2, #3)

## Goal

Surface the `usage_events` data (already being written since Phase 6/8) as real, useful UI — per-contact inline badge and a spend-over-time dashboard. Most of the hard part (correct token/cost accounting) was front-loaded into Phase 5; this phase is primarily UI plus finishing the Codex cost-formula work if it wasn't fully nailed down earlier.

## Scope

1. **`UsageBadge`**
   - Wire Phase 2's shell to real per-Contact aggregated `usage_events` (sum of `costUsd`, sum of tokens) — inline in the sidebar per blueprint §10.
   - Decide aggregation window (all-time vs. rolling) — all-time running total is the simplest v1 read, consistent with blueprint §4's note that events are logged per-turn specifically to support a spend-over-time view without race conditions on a running total.

2. **`UsageDashboard`**
   - Spend over time, broken down by persona and by repo (blueprint §10).
   - Basic filters: date range, by Contact, by source (`message` vs. `routine`) — routines are called out in blueprint §7 as needing more visible cost tracking since they're unsupervised.
   - Simple charting — bar/line over time. If building this as a real chart (not just a table), consult the `dataviz` skill for palette/accessibility guidance rather than picking chart colors ad hoc.

3. **Finish Codex cost accounting** (Phase 5 built it — this is re-verification, not construction)
   - `src/main/adapters/pricing.ts` already holds the per-model table, a `LAST_VERIFIED` date, and `computeCodexCost`. Blueprint §14 open item #2 is settled: `cached_input_tokens` is a subset of `input_tokens`, so cached tokens are a discount and never an extra charge. **Re-check `LAST_VERIFIED` first** — prices move, and a stale table misreports spend silently.
   - Phase 6 adds a per-persona model choice, so a single Contact's history can span models. Aggregate on the `model` recorded on each `UsageEvent` rather than on the persona's current setting, or changing a model silently reprices past turns. **The column now exists** — `usage_events.model` and `cost_source` were added by migration `0004` during the post-Phase-5 review, along with `cache_write_input_tokens` and `reasoning_output_tokens`. When this note was first written the schema could not support it; it can now. Rows written before `0004` have no model, so treat "unknown model" as a real bucket rather than folding it into a default.
   - Label estimates honestly using `cost_source`. `'sdk'` is a figure Anthropic returned; `'computed'` is our own arithmetic over `src/main/adapters/pricing.ts`. Presenting them as the same kind of number is the sort of thing that reads fine until someone reconciles against a real invoice.

4. **Aggregation must not silently drop unpriced spend**
   - `aggregateUsage` in `src/renderer/src/lib/usage.ts` skips events with `costUsd === null` and returns a plain number, which `formatCost` then renders as a confident `$12.34`. Since Phase 5 gave Codex a price table, null now means "this model isn't in `CODEX_PRICES`" — so an unpriced model's turns vanish from the total with no indication that anything is missing.
   - `formatCost` was written carefully to print `—` rather than `$0.00` for a single null cost. The aggregate throws that care away the moment there is more than one event.
   - Return an unpriced-event count alongside the total and render a partial total distinctly (`$12.34+`, or the count beside it). A total that is honest about what it excludes beats one that is quietly wrong.
   - Two known gaps left deliberately: the table has no context dimension, so `gpt-5.5`/`gpt-5.4` long sessions are priced at the sub-272K tier and under-report; and an unpriced model returns `null`, which the UI must render as "unknown" rather than as `$0.00`.
   - Confirm the price table built in Phase 5 is actually being read correctly per-model (i.e. the right row is selected for the model the session actually used, not a hardcoded default).
   - Spot-check a handful of real Codex sessions' computed cost against what the token counts would suggest by hand, to catch a bad formula before it silently misreports spend.

## Explicitly out of scope

- Any budget cap enforcement / auto-pausing a Routine on overspend — v1 is logging/display only (blueprint §13). Leave a clear seam (e.g. a documented place where a threshold check could later be inserted) but don't build it.

## Acceptance checks

- [x] `UsageBadge` on a Contact updates immediately after a turn completes (message or routine). **The routine half was broken and is the defect this phase found** — see below. Mechanism unit-tested (`usage-events.test.ts`, `messaging.test.ts`); the on-screen confirmation is the one thing left for the live pass.
- [x] `UsageDashboard` correctly aggregates across both backends — verified in `e2e/usage.spec.ts` with an `sdk`-priced Claude contact and a `computed`-priced Codex contact rolling into one view.
- [x] Filtering by `source: routine` isolates unsupervised spend specifically (unit + E2E).
- [x] Codex cost figures spot-checked by hand against raw token counts for three real sessions — exact to 6dp, table below.
- [x] A Contact whose history spans two models attributes each turn's spend to the model that actually ran (unit + E2E: one contact, `gpt-5.5` and `gpt-5.4-mini`, split correctly).
- [x] A total containing an unpriced turn is visibly partial rather than silently short — `$12.34+`. Proven non-vacuous by mutation.

## What was built

The phase doc assumed more construction than was needed and less correction. `UsageBadge` was
already on real data (Phase 6 wired it into `ThreadView` and `ConversationList`); what was still
mock-fed was `UsageDashboard` and `UsageScopeList`. And the premise underneath all three had gone
stale.

**The false claim.** Six places asserted that Codex reports tokens but no dollar figure — including
two pieces of user-visible copy, one of which named the personas it applied to. Phase 5 built
`src/main/adapters/pricing.ts` and `codex.ts:144` has computed a real Codex cost on every turn
since. Worse, `src/renderer/src/mocks/usageEvents.ts` _manufactured_ the evidence: every Codex
fixture row was seeded `costUsd: null`, so the dashboard was narrating a story the fixtures had
been written to tell. `costUsd === null` now means one thing — the model has no row in
`CODEX_PRICES` — and it can happen on either backend.

**The real defect.** `aggregateUsage` skipped null-cost events and returned a plain number, so a
mixed set rendered a confident `$12.34` that was short by whatever the unpriced turns cost.
`formatCost` had been written carefully to print `—` for a single unknown; the aggregate discarded
that care as soon as there was more than one event. `UsageSummary` now carries priced/unpriced
counts and `formatCostSummary` renders `$12.34+`. Note `ConversationListItem` formatted the cost
itself rather than going through `UsageBadge`, so it was a second silently-partial total that
fixing the badge alone would have left behind.

**Architecture.** All arithmetic lives in `src/renderer/src/lib/usage-report.ts` as pure functions;
the components pick filters and render. Not tidiness — the Vitest renderer project matches
`*.test.ts` only and `@testing-library` is not installed, so anything computed inside a `.tsx` is
untestable by construction. Four breakdowns run off one `groupUsage` and four selectors.

**No IPC change.** `usage.list`, `contacts.list` and `personas.list` already existed and the rollup
happens in the renderer, which is what let this phase run alongside Phase 9 without touching
`ipc-contract.ts` or `ThreadView.tsx`.

## The defect this phase found: unattended spend went unnoticed

Not in the original scope, and it defeated acceptance check #1 outright.

Usage was invalidated from `useAgentStream` on `done`, which only reaches a component subscribed to
that specific `runId`, and only while that thread is mounted. A scheduled routine satisfies
neither — so watching the dashboard while a routine spent money showed a stale total indefinitely.

`runs-changed` looks like the obvious signal and is the wrong one: `messaging.ts` fires
`emitRunsChanged()` in its `finally` at :467 and only _then_ calls `summarizeTurn`, which records
the summary turn's usage from `compaction.ts`. A runs-based refetch would therefore arrive before
the row it was meant to collect, and coordination spend would lag a turn behind forever.

Resolved with a `usage-changed` push emitted from `recordUsage` itself — the one point all four
sources pass through — after the insert, so it cannot race the row it announces. Subscribed inside
`useUsageEvents` rather than in a component, so every consumer is covered by construction.

## Codex cost, spot-checked by hand

Three real rows from the dev profile, all `gpt-5.5` / `cost_source: 'computed'`, against
`CODEX_PRICES['gpt-5.5']` (input 5.0 / cached 0.5 / output 30.0 per 1M):

| row        | input | cached | output | uncached×5 | cached×0.5 | output×30 | computed     | stored      |
| ---------- | ----- | ------ | ------ | ---------- | ---------- | --------- | ------------ | ----------- |
| `d940fddd` | 60709 | 47616  | 374    | 0.065465   | 0.023808   | 0.011220  | **0.100493** | 0.100493 ✅ |
| `22078d46` | 45417 | 33920  | 364    | 0.057485   | 0.016960   | 0.010920  | **0.085365** | 0.085365 ✅ |
| `c465f9dd` | 12431 | 8576   | 45     | 0.019275   | 0.004288   | 0.001350  | **0.024913** | 0.024913 ✅ |

Exact on all three. This also confirms the right price row is selected for the model that actually
ran rather than a hardcoded default, and that cached tokens are subtracted from input rather than
billed twice. `LAST_VERIFIED = '2026-08-16'` re-checked and current as of this phase.

## Known gaps, deliberately left

- ~~**The 272K-context tier under-reports, and the `+` does not warn about it.**~~ **Closed
  2026-08-17.** `pricing.ts` grew a `longContext` dimension with the vendor's real rates, selected
  on a turn's own input tokens. Scaled from the observed turn above, the gap was 47% — $0.4272
  reported against $0.8103 actually billed.
- ~~**`contacts.delete` cascades its usage rows away.**~~ **Closed 2026-08-17.** Migration `0008`
  rebuilt `usage_events` with `ON DELETE SET NULL` and denormalised `persona_template_id` /
  `repo_path`, backfilling every historical row as it copied.
- **`usage.list` is unbounded** and the renderer pulls every event. Fine at hundreds, a problem long
  before it is a correctness issue. The fix is a server-side aggregate procedure, which would mean
  editing `ipc-contract.ts` — deliberately avoided while Phase 9 owned that file. **Still open.**
- **`sdk` vs `computed` is not surfaced**, by the user's decision (2026-08-16), overriding scope
  item 3's "label estimates honestly". The column is still recorded per row, so the distinction is
  available whenever it is wanted.

## Follow-up pass — cost fidelity and the model menu (2026-08-17)

Two of the three gaps above are closed, and both model menus were refreshed against live vendor
pricing. Recorded here because the numbers are the kind that go stale silently.

**Long-context pricing.** Only some models are tiered, and the long rates are transcribed rather
than derived — input and cached double, output rises by half:

| model           | ≤272K in/cached/out  | >272K in/cached/out  |
| --------------- | -------------------- | -------------------- |
| `gpt-5.6-cyber` | 12.50 / 1.25 / 75.00 | single tier          |
| `gpt-5.6-sol`   | 5.00 / 0.50 / 30.00  | 10.00 / 1.00 / 45.00 |
| `gpt-5.6-terra` | 2.00 / 0.20 / 12.00  | 4.00 / 0.40 / 18.00  |
| `gpt-5.6-luna`  | 0.20 / 0.02 / 1.20   | 0.40 / 0.04 / 1.80   |
| `gpt-5.5`       | 5.00 / 0.50 / 30.00  | 10.00 / 1.00 / 45.00 |
| `gpt-5.4`       | 2.50 / 0.25 / 15.00  | 5.00 / 0.50 / 22.50  |

The threshold is compared against **one turn's own input tokens** — the delta, after the Codex
baseline is subtracted — because cumulative input is the running sum of each request's prompt, which
makes the delta that request's prompt. Consequence worth knowing: a long conversation whose
individual turns each stay under the threshold is priced short throughout. The tier is a property of
a request, not of a conversation.

**Model menus.** Claude went from four models to eight (the whole 4.6/4.7/4.8 generation was
missing) and moved to undated aliases. Codex gained the three `gpt-5.6` models it was missing
(`terra`, `luna`, `cyber`) beside `sol`. A new `models.test.ts` pins the invariant models.ts only
asserted in a comment: every Codex model offered has a price row, and so does the summariser.

**Deliberately not done:** `SUMMARY_MODELS.codex` stays `gpt-5.4-mini` even though `gpt-5.6-luna`
now undercuts it 3.75× on both input and output (0.20/1.20 against 0.75/4.50). A summariser runs
after every turn so the saving is real, but its output is load-bearing — Phase 7 found a
mis-categorised summary silently drops a turn's work out of every colleague's context — and nothing
here can measure summary quality. **This is the open decision worth a live check**, not a change to
make while refreshing a list.

**One thing the follow-up found rather than fixed.** Adding an orphaned-spend row to the E2E
exposed that the dashboard's scope filter still worked by contact id, so a deleted Contact's spend
vanished when you scoped to the very repo the by-repo breakdown listed it under — two totals on one
screen disagreeing about the same money. `scopeFilter` now resolves attribution the same way the
breakdowns do. The fix was half-finished until a test asked the awkward question.

## Left for the live pass

Everything above is unit- or E2E-verified. What no test can cover, because the suite deliberately
never starts a paid turn:

- Send a turn on a Claude Contact and one on a Codex Contact and confirm the badge moves
  immediately and both roll into one comparable view with real figures.
- Fire a routine with the **dashboard** open (not the routine's thread) and confirm the total moves
  — that is the `usage-changed` channel's whole reason to exist, and the check most likely to
  regress.
- Both themes, since three of the five palette slots sit under 3:1 on the light surface.
