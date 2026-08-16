# Phase 2 — Design System

**Status:** Not started
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

- [ ] App launches into the sidebar + thread layout, matching iMessage's visual grammar (not a generic chat template).
- [ ] Both light and dark mode render correctly with no unstyled/broken states.
- [ ] All four `GroupMessage` type variants are visually distinct and legible.
- [ ] Markdown + code block rendering works in a message bubble (headings, lists, fenced code with syntax highlighting).
- [ ] Every component listed in blueprint §10's table exists as at least a static/mock-data shell.
- [ ] Navigating between sidebar entries switches the main panel with no console errors.

## Notes for whoever picks this up

- This is the highest-leverage phase for "does this look considered rather than templated" — take the time here rather than rushing to wire real data. Once Phase 6 wires real streaming into `ThreadView`, changing the visual design becomes more expensive because it's entangled with behavior.
- Keep mock data in one fixtures file (e.g. `src/renderer/mocks/`) so it's trivial to delete once real data flows in later phases — don't scatter inline mock objects across components.
