# Phase 10 — Usage & Cost Dashboard

**Status:** Not started
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
   - Phase 6 adds a per-persona model choice, so a single Contact's history can span models. Aggregate on the `model` recorded on each `UsageEvent` rather than on the persona's current setting, or changing a model silently reprices past turns.
   - Two known gaps left deliberately: the table has no context dimension, so `gpt-5.5`/`gpt-5.4` long sessions are priced at the sub-272K tier and under-report; and an unpriced model returns `null`, which the UI must render as "unknown" rather than as `$0.00`.
   - Confirm the price table built in Phase 5 is actually being read correctly per-model (i.e. the right row is selected for the model the session actually used, not a hardcoded default).
   - Spot-check a handful of real Codex sessions' computed cost against what the token counts would suggest by hand, to catch a bad formula before it silently misreports spend.

## Explicitly out of scope

- Any budget cap enforcement / auto-pausing a Routine on overspend — v1 is logging/display only (blueprint §13). Leave a clear seam (e.g. a documented place where a threshold check could later be inserted) but don't build it.

## Acceptance checks

- [ ] `UsageBadge` on a Contact updates immediately after a turn completes (message or routine).
- [ ] `UsageDashboard` correctly aggregates across both backends — a Contact using Claude and one using Codex both roll up into the same spend-over-time view with comparable numbers.
- [ ] Filtering by `source: routine` isolates unsupervised spend specifically.
- [ ] Codex cost figures spot-checked by hand against raw token counts for at least 2-3 real sessions, discrepancy explained or fixed.
