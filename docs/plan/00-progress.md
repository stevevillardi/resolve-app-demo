# Persona Router — Progress Tracker

Source of truth for build order. Each phase has its own file in this directory with detailed scope, deliverables, and acceptance checks. Update the table below as phases move — this file should always reflect current reality, not the plan as originally written.

**Reference:** [`persona-router-blueprint.md`](../../persona-router-blueprint.md) (repo root) is the design source of truth. These phase docs implement it; if a phase doc and the blueprint disagree, the blueprint wins unless a decision below explicitly supersedes it.

## Status legend
`Not started` · `In progress` · `Blocked` · `Done`

## Phases

| # | Phase | File | Status | Notes |
|---|---|---|---|---|
| 1 | Bootstrap | [01-bootstrap.md](01-bootstrap.md) | Done | electron-vite + React + TS + npm, Tailwind v4/shadcn (Base UI) install, hand-rolled typed IPC skeleton, SQLite+Drizzle base, lint/format, packaging config. All 6 acceptance checks verified on branch `phase-1-bootstrap`. |
| 2 | Design system | [02-design-system.md](02-design-system.md) | Done | Full static/mock-data app shell — all 16 components from blueprint §10 (+ GitHubConnectDialog, see decision below) built and reachable. **Reworked 2026-08-15** (see the doc's "Revision" section): three-pane shell (shadcn `Sidebar` nav rail + resizable panels), oklch palette, Inter/JetBrains Mono bundled, group-message types separated by structure rather than colour, recharts usage dashboard, native macOS window chrome, plus 9 defect fixes including broken dark-mode syntax highlighting. All 6 acceptance checks re-verified via `npm run dev` + lint/typecheck/build in both modes. |
| 3 | App auth | [03-app-auth.md](03-app-auth.md) | Not started | Claude/Codex SDK auth onboarding + GitHub OAuth Device Flow, combined first-run flow |
| 4 | Data layer | [04-data-layer.md](04-data-layer.md) | Not started | Drizzle schema/migrations, IPC CRUD for skills/personas/contacts |
| 5 | Backend adapters | [05-backend-adapters.md](05-backend-adapters.md) | Not started | AgentAdapter interface, Claude + Codex adapters, event normalization |
| 6 | Core messaging | [06-core-messaging.md](06-core-messaging.md) | Not started | NewContactFlow, real 1:1 ThreadView, streaming, sandbox enforcement, UsageEvent logging |
| 7 | Group coordination | [07-group-coordination.md](07-group-coordination.md) | Not started | Group/GroupMessage, compaction, @mention routing, concurrency lock |
| 8 | Routines & scheduler | [08-routines-scheduler.md](08-routines-scheduler.md) | Not started | node-cron, tray/background residency, RoutineEditor, manual run-now |
| 9 | GitHub remote actions | [09-github-remote-actions.md](09-github-remote-actions.md) | Not started | OpenPRButton, Octokit push/PR/comment, githubScope enforcement |
| 10 | Usage & cost dashboard | [10-usage-cost-dashboard.md](10-usage-cost-dashboard.md) | Not started | UsageBadge, UsageDashboard, Codex price table + cost formula |
| 11 | Demo journeys & polish | [11-demo-journeys-polish.md](11-demo-journeys-polish.md) | Not started | End-to-end pass of the 3 critical journeys (blueprint §16), failure-state polish |

## Cross-cutting open items (blueprint §14)

Track these until each is explicitly resolved in the phase that touches it — don't let them get lost:

- [ ] Confirm `config.developer_instructions` actually reaches the Codex model (→ Phase 5)
- [ ] Confirm whether Codex `cached_input_tokens` is additive or a subset of `input_tokens` (→ Phase 5 / Phase 10)
- [ ] Build/verify Codex per-model price table (→ Phase 10)
- [ ] Decide durable-entry retention / re-summarization threshold (deferred past v1 per blueprint, revisit if Phase 7 surfaces it early)

## Decisions made during planning (not in blueprint, resolve ambiguity)

- **Package manager:** npm.
- **Electron tooling:** electron-vite (main/preload/renderer, HMR) + electron-builder for packaging.
- **Repo structure:** single package, not a monorepo — schema stays small enough per blueprint §11 that pnpm workspaces would be overhead.
- **Phase 3 scope:** Claude/Codex SDK auth (blueprint §15A) and GitHub OAuth Device Flow (blueprint §9) are done together as one "app auth" phase, since both gate any real persona/contact work and share first-run onboarding UI.
- **Plan docs location:** `/docs/plan/`, numbered filenames, this tracker as `00-progress.md`.
- **Main↔renderer bridge — supersedes blueprint §11/§2 (resolved 2026-08-15, during Phase 1 planning):** `electron-trpc` is a no-go. Verified via live npm registry + GitHub API checks against the version we'd actually be running: latest release `0.7.1` published 2024-12-07 (~20 months stale); open, unresolved issue #227 "Compatibility with @trpc/client v11" (opened 2025-06-13); open issue #229 "Error when used with `moduleResolution: Bundler`" (opened 2025-11-18) — the electron-vite scaffold uses bundler resolution by default, so this isn't a theoretical edge case. The one v11-targeting fork (`trpc-electron`) is equally stale (single release, ~19 months old, no follow-up). Blueprint §11 itself flagged "verify actively maintained... early" as a gate for this exact package — this is that verification, and it failed.
  Replaced with a hand-rolled, Zod-validated typed IPC layer (`src/shared/ipc-contract.ts` as the single source of truth for procedure name → input/output schema, `ipcMain.handle`/`ipcRenderer.invoke` underneath). Built in Phase 1 (see `01-bootstrap.md`). Preserves the original goal (single typed contract, validated at the boundary, no per-procedure bespoke preload methods) without the dependency risk. Where any phase doc says "tRPC procedure" or "tRPC subscription," read it as "IPC procedure" / the IPC layer's streaming primitive — phase docs 03-06 have been updated accordingly. If `electron-trpc` ships a real v11-compatible release later, migration is contained to `src/main/ipc/*` and `src/renderer/src/lib/ipc-client.ts` — not a blocker for any phase.
- **Tailwind version — clarifies blueprint §11 (resolved 2026-08-15):** Tailwind is v4 (CSS-first config: `@import "tailwindcss"` + `@tailwindcss/vite` plugin), not the v3 `tailwind.config.js`/`postcss.config.js` pattern implied by older tutorials. Built in Phase 1.
- **Supporting screens are workspace views, not overlays — supersedes blueprint §11 (resolved 2026-08-15, during the design-system overhaul):** blueprint §11 justifies shadcn by noting that `Dialog`/`Sheet`/`Popover` "cover persona editor, new-contact flow, skill library, routine editor," which the first Phase 2 pass took literally — all five secondary screens opened as modals from a six-icon strip in the sidebar footer. That put the persona editor, the skill library, and the whole usage dashboard into `sm:max-w-md`/`sm:max-w-lg` boxes, and gave the app no navigation model beyond "pick a conversation."
  Resolved in favour of a three-pane shell: an icon nav rail (shadcn `Sidebar`, `collapsible="icon"`, ⌘B) → a resizable list panel → a content pane, with Chats, Personas, Skills, Routines, and Usage each a master-detail section. `NewContactFlow` and `GitHubConnectDialog` stay modal, since both are short decision-shaped flows you finish and dismiss rather than places you work. The component names from §10 are unchanged — `PersonaDetailPanel`, `SkillLibraryView`, `RoutineEditor`, and `UsageDashboard` are the same files, rendering inline instead of inside a `Sheet`/`Dialog` — so §10 coverage still holds. Blueprint §11's reasoning about *which* shadcn primitives are needed is unaffected; only the placement of four screens changed. See `docs/plan/02-design-system.md`'s "Revision" section for the full scope of that pass.
- **`GitHubConnectDialog` scope — supersedes `02-design-system.md`'s exclusion list (resolved 2026-08-15, during Phase 2):** `02-design-system.md` explicitly excludes `GitHubConnectDialog` from Phase 2 ("that's Phase 3, since it's tied to actual auth state"), but `03-app-auth.md` assumes a Phase-2-built shell already exists to wire real device-flow state into. Resolved in favor of building a minimal, fully static `GitHubConnectDialog` shell in Phase 2 alongside the other 15 components — 4 prop-driven states (`not_connected` / `awaiting_authorization` / `polling` / `connected`), no OAuth logic, no IPC calls — so Phase 3 has a shell to wire into instead of building UI and auth logic simultaneously, consistent with how every other screen in this phase is handled. Not counted against Phase 2's own acceptance checks (decorative/out-of-scope for behavior, in-scope for visual shell only). See `src/renderer/src/components/github/GitHubConnectDialog.tsx`.
