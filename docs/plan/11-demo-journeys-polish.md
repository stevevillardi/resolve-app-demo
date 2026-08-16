# Phase 11 — Demo Journeys & Polish

**Status:** Not started
**Blueprint refs:** §16 (all three journeys), §13 (scope cuts — verify nothing crept back in), §15 (all cross-cutting decisions)

## Goal

Final pass: run all three blueprint §16 journeys back-to-back in one sitting, on a clean app state, and fix whatever breaks at the seams between phases. Individual phases test their own slice; this phase is where integration gaps between them get caught — e.g. does Journey 2's Group summary correctly show up when Journey 1's Contact is also active, does Journey 3's routine respect a concurrency lock held by a Journey 1 interactive session, etc.

## Scope

1. **Full journey run-through, clean state**
   - Fresh app install (or a reset DB) → onboarding → Journey 1 → Journey 2 → Journey 3, in sequence, without developer intervention beyond what the journeys themselves specify (e.g. Journey 3's manual "run now" is allowed, that's by design).
   - Fix any integration bug found — a bug found here is by definition a gap between two phases that neither phase's own acceptance checks caught in isolation.

2. **Scope-cut audit (blueprint §13)**
   - Explicitly verify none of the deliberate v1 cuts crept back in as half-built features: no Cursor backend, no many-to-many persona/repo binding, no real-time multi-session sync, no vector search, no broadcast @mention, no hard budget caps. If any of these partially exist, either finish them properly or strip the half-built version — no half-finished implementations left in place.

3. **Cross-cutting decisions audit (blueprint §15)**
   - Re-check each of A–E against the actual running app: auth mirrors correctly (A), no per-action approval interrupts exist (B), failure states render consistently everywhere, not just where Phase 6 tested them (C), the concurrency lock is the same single in-memory map used consistently by messages/mentions/routines (D), tray/background residency actually works end to end (E).

4. **UI polish pass**
   - Loading states, empty states (no Contacts yet, no routines yet, empty Group), and error copy reviewed for clarity — these are easy to under-build during feature phases since acceptance checks focus on the happy path.
   - Dark/light mode spot-check across every screen built since Phase 2, since new screens in Phases 4-10 may not have been checked against both themes as carefully as the original design-system pass.

5. **README / demo runbook**
   - A short top-level `README.md` (if not already useful from Phase 1) covering: how to run the app, how to complete onboarding, and a condensed version of the three journeys as a demo script — useful both for the actual demo and for anyone picking this project up cold later.

## Explicitly out of scope

- New features not already specified in the blueprint. This phase is integration and polish, not scope expansion.

## Acceptance checks

- [ ] All three blueprint §16 journeys run successfully in one continuous session on a clean/reset app state.
- [ ] Scope-cut audit complete, nothing half-built found (or found items resolved).
- [ ] Cross-cutting decisions A-E all verified against the real running app.
- [ ] Every screen reachable in the app has a sane empty state and a sane error state, not just a happy-path render.
- [ ] Demo runbook written and another person (or a fresh read by whoever's demoing) can follow it without needing to ask what a step means.
