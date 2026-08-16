# Phase 2 — Design System

**Status:** Done
**Blueprint refs:** §10 (UI/UX component mapping), §11 (styling stack)
**Depends on:** Phase 1 (bootstrap)

## Goal

Build the visual language and the static app shell — iMessage-style layout, working navigation between a sidebar and a thread view — entirely on mock/static data. No backend adapters, no real persistence, no auth. By the end, the app should *look* and *navigate* like the finished product even though nothing is real yet.

Doing this before auth/data/adapters is deliberate: it lets layout and visual decisions get made and reviewed without being entangled with backend plumbing, and gives every later phase a real UI to plug into instead of building UI and logic simultaneously.

## Scope

1. **Theme tokens**
   - Tailwind theme config: color palette (light + dark mode — iMessage itself supports both, match that), spacing/radius scale, font stack.
   - Decide the visual identity beyond "looks like iMessage" — bubble colors for outbound/inbound, accent color for contacts vs. groups, distinct visual treatment for system/journal/routine messages (blueprint §10 calls for `JournalNotice` and `RoutineRunNotice` to read differently from a live reply).
   - If unsure on specific look-and-feel choices, use the `frontend-design` skill for guidance rather than guessing at generic shadcn defaults.

2. **shadcn/ui component selection**
   - Install the specific components needed: `Command` (for the future `MentionPicker`), `Dialog`, `Sheet`, `Popover`, `Avatar`, `Badge`, `ScrollArea`, `Tabs`, plus whatever the layout needs (`Separator`, `Tooltip`, etc.).
   - Don't install the whole shadcn catalog speculatively — pull components in as each screen in this phase actually needs them.

3. **Layout shell (static/mock data)**
   - `ConversationList` — sidebar rendering a mocked mix of `Contact` and `Group` entries, with avatar/color, name, last-message preview.
   - `ThreadView` — 1:1 thread layout: message list + composer, using mocked `MessageBubble` content (both outbound/inbound styles).
   - `GroupThreadView` — same shape as `ThreadView` but rendering mocked `GroupMessage`s, including at least one of each type (`system_summary`, `user_mention`, `agent_reply`, `routine_run`) so all the visual variants get built now.
   - `MessageBubble` — outbound/inbound variants, markdown/code rendering via `react-markdown` + `shiki` (install now, wire against static markdown fixtures — real streaming content comes in Phase 6).
   - `StreamingIndicator` — visual design only; no real streaming yet. Note in the component that Claude and Codex will eventually need visually distinct loading states (blueprint §3 — Claude can't show tool-execution progress, Codex can) even though both adapters don't exist yet.
   - `JournalNotice`, `RoutineRunNotice` — distinct visual treatment per blueprint §10.
   - App-level routing/state: clicking a sidebar entry switches the main panel between `ThreadView` and `GroupThreadView`. Local-only state (Zustand) for "selected conversation" — no persistence yet.

4. **Supporting static screens** (structure and visual design now, wired to real logic in later phases)
   - `PersonaDetailPanel` — form layout for persona fields (name, avatar/color, backend picker, system prompt, skill multi-select, sandbox, githubScope), non-functional.
   - `SkillLibraryView` — list/CRUD shell for skills, non-functional.
   - `NewContactFlow` — multi-step dialog shell (persona pick → repo pick → confirm), repo picker uses mock repo list.
   - `RoutineEditor` — schedule picker + prompt field shell, non-functional.
   - `UsageBadge` / `UsageDashboard` — visual design with mock numbers.

## Explicitly out of scope for this phase

- Any real backend call, IPC procedure beyond what Phase 1 proved, SDK, or SQLite-backed data.
- GitHub OAuth UI (`GitHubConnectDialog`) — that's Phase 3, since it's tied to actual auth state.
- Real @mention filtering logic (the picker UI can exist, but wiring it to real contact-by-repo filtering is Phase 7).

## Acceptance checks

- [x] App launches into the sidebar + thread layout, matching iMessage's visual grammar (not a generic chat template).
- [x] Both light and dark mode render correctly with no unstyled/broken states.
- [x] All four `GroupMessage` type variants are visually distinct and legible.
- [x] Markdown + code block rendering works in a message bubble (headings, lists, fenced code with syntax highlighting).
- [x] Every component listed in blueprint §10's table exists as at least a static/mock-data shell (plus `GitHubConnectDialog`, pulled in early — see `00-progress.md` decision log).
- [x] Navigating between sidebar entries switches the main panel with no console errors.

## Revision — design system overhaul (2026-08-15)

The first pass met every acceptance check above but read as templated rather than designed, and was reworked. What changed, and why:

- **Shell.** `AppShell` was a two-`div` flex with a fixed 288px sidebar. Replaced with a three-pane shell: shadcn `Sidebar` (`collapsible="icon"`, ⌘B) as an icon nav rail → a resizable list panel (`react-resizable-panels`, width persisted) → the content pane. Every section is master-detail, which is what makes the resizable list worth having across all five.
- **Sections, not overlays.** Personas, Skills, Routines, and Usage were five icon buttons in a footer strip opening cramped dialogs; they are now real workspace views. `NewContactFlow` and `GitHubConnectDialog` stay modal. See the decision-log entry in `00-progress.md`.
- **Structure replaced colour.** The "signal rail" (`border-l-[3px]` + a tint) had been applied to sidebar rows, journal notices, routine notices, and mention boxes — one trick doing four jobs. The four `GroupMessage` variants are now told apart by shape: filled inbound bubble / outbound bubble / centred hairline record / timeline log row. Verified by desaturating a screenshot to greyscale.
- **Signature element.** The rail was replaced by `ScopeChip` — a monospace capsule showing sandbox level and GitHub scope, prefixed `fs`/`gh` since both axes share value names. It appears in the thread composer, persona rows, the mention picker, and the routine editor. Governance is the product's differentiator (§16 Journey 3) and was previously invisible outside a settings sheet.
- **Tokens.** ~24 hand-rolled notice/bubble CSS variables applied via inline `style={{}}` (so no `dark:`, `hover:`, or opacity modifiers ever worked) collapsed to 8 wired through `@theme inline`. Palette is now oklch. `--radius` 0.625rem, with the large curve kept only for bubbles and pills.
- **Typography.** Inter Variable + JetBrains Mono, bundled via `@fontsource-variable` (no CDN). Mono carries a rule: anything that is a machine identifier — repo path, cron expression, scope level, cost, token count, session id — is set in it. Ligatures are disabled so `===` stays `===`.
- **Charts.** `UsageDashboard` moved from hand-rolled `<div>` bars in a `sm:max-w-lg` dialog to recharts + shadcn `Chart`.

### Defects fixed in the same pass

| Defect | Effect |
|---|---|
| Shiki emitted `--shiki-dark` with no CSS rule consuming it | Code blocks rendered light-theme colours in dark mode |
| `TooltipTrigger`/`PopoverTrigger` wrapping a `<Button>` without `render` | `<button>` inside `<button>` in `OpenPRButton` and `MentionPicker` |
| `bg-white` on the routine toggle knob | Hard white in dark mode (now shadcn `Switch`) |
| Nested `<Dialog>` as a sibling of `DialogContent` in `SkillLibraryView` | Stacked backdrops, detail dialog had no close |
| Form state initialised from props once, components never unmounted | Editing one persona then opening another showed the first one's values (now keyed by entity id) |
| GFM tables, blockquote, `hr`, `h4`–`h6` unstyled despite `remarkGfm` | Tables rendered as raw markup |
| `lucide-react` has no `Github` icon in v1; `GitFork` had been substituted | Wrong icon on a GitHub affordance (now an inlined mark) |
| `codeToHtml()` called per mount | Re-instantiated the shiki engine per code block (now a cached `createHighlighter`) |
| `Composer` used `rows={1}` + `max-h-32` | The textarea never actually grew |

### Notes carried forward

- The "+" action is only shown for Chats. Creating a persona, skill, or routine needs somewhere to persist it — restore those buttons in Phase 4 alongside the CRUD procedures.
- The `--chart-*` values are the dataviz reference categorical set, re-stepped per mode, validated against the real `--card` surfaces in both modes (worst adjacent CVD ΔE 9.1 light / 8.4 dark). The theme the palette came from failed that check; do not swap them back without re-running `validate_palette.js`.

## Notes for whoever picks this up

- This is the highest-leverage phase for "does this look considered rather than templated" — take the time here rather than rushing to wire real data. Once Phase 6 wires real streaming into `ThreadView`, changing the visual design becomes more expensive because it's entangled with behavior.
- Keep mock data in one fixtures file (e.g. `src/renderer/mocks/`) so it's trivial to delete once real data flows in later phases — don't scatter inline mock objects across components.
