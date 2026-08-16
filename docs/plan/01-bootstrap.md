# Phase 1 — Bootstrap

**Status:** Done
**Blueprint refs:** §11 (tech stack), §2 (architecture/process boundary)

## Goal

Get an empty repo to "electron-vite dev launches a blank window, main/preload/renderer are wired, IPC round-trips, DB file gets created" — no product features yet. Everything after this phase builds on top of a working shell.

## Scope

1. **Project init**
   - `npm create @quick-start/electron@latest <tmp-dir> -- --template react-ts`, run outside the repo (repo isn't empty — has planning docs already), then merge generated files into the repo root and delete the temp dir. This is electron-vite's own official scaffold tool (`@quick-start/create-electron`) — do not use the similarly-named `create-electron-vite`, which is ~2 years stale.
   - Set `"name": "persona-router"` in `package.json` and `productName: Persona Router` in `electron-builder.yml` immediately after merging, before any dev/build run — this fixes the `app.getPath('userData')` directory name consistently across dev and packaged runs from the start.
   - Confirm Node version (pin via `.nvmrc`; electron-vite requires `^20.19.0 || >=22.12.0`).
   - `.gitignore` (node_modules, dist, out, *.db*, .env, .eslintcache, safeStorage-related local secrets) — merge with the scaffold's generated `.gitignore` rather than overwrite either.

2. **Process layout** (blueprint §2 process boundary rule)
   - `src/main/` — main process entry, adapters, services, scheduler, SQLite access. Nothing here is reachable from the renderer except via IPC.
   - `src/preload/` (+ `index.d.ts`) — contextBridge exposure, kept minimal: a single generic `invoke(name, input)` bridge for the hand-rolled IPC layer (see IPC bridge section below), not one bespoke method per procedure.
   - `src/renderer/src/` — React app (the scaffold nests renderer source one level deeper than `src/renderer/` — confirmed from the actual template, adjust path aliases/lint globs accordingly rather than fighting it).
   - Enforce via lint config (no importing `src/main/*` from `src/renderer/**`) — a plain ESLint `no-restricted-imports` rule per project, not a custom plugin. **Prove it actually fires**: add a deliberately bad import in a renderer file, confirm `npm run lint` fails, then remove it — a rule that's never caught a violation isn't a verified gate.

3. **Tooling**
   - TypeScript strict mode across all three process targets, separate `tsconfig` per target extending a shared base.
   - ESLint + Prettier, minimal ruleset to start (don't over-configure before there's real code to lint against).
   - npm scripts: `dev`, `build`, `lint`, `typecheck`, `package` (electron-builder).

4. **Styling baseline**
   - Tailwind is v4, which uses a **CSS-first config model**, not the old v3 `tailwind.config.js`/`postcss.config.js` pattern: install `tailwindcss` + `@tailwindcss/vite` (pinned to the same version — released in lockstep), add `@import "tailwindcss";` to the renderer's CSS entry, add the `@tailwindcss/vite` plugin to `electron.vite.config.ts`'s `renderer.plugins`. Several circulating tutorials still show v3-style config — don't follow them.
   - Install shadcn/ui CLI and initialize (`npx shadcn@latest init`) — answer prompts manually rather than trust autodetection, since electron-vite's nested `src/renderer/src` layout isn't what the CLI expects by default; correct `components.json`'s aliases afterward if needed. Component selection itself is Phase 2, this step just proves the pipeline works (render one shadcn `Button` in the blank window).

5. **IPC bridge — hand-rolled typed layer (not electron-trpc)**
   - **Decision (resolved during Phase 1 planning, see `docs/plan/00-progress.md` decisions log):** `electron-trpc` is a no-go — verified stale (~20 months since last release) with open, unresolved GitHub issues hitting this exact toolchain (tRPC v11 incompatibility, `moduleResolution: Bundler` incompatibility, which the electron-vite scaffold uses by default). Don't spend time trialing it; build the fallback directly.
   - Structure:
     ```
     src/shared/ipc-contract.ts         # procedure name → { input: ZodSchema, output: ZodSchema } — single source of truth
     src/main/ipc/registerProcedure.ts  # ipcMain.handle wrapper: parses input via contract, runs handler, parses output
     src/main/ipc/procedures/ping.ts    # first real procedure — this phase's test button
     src/main/ipc/index.ts              # registers all procedures on startup
     src/preload/index.ts               # exposes ONE generic invoke(name, input) via contextBridge
     src/renderer/src/lib/ipc-client.ts # typed callProcedure<K>(name, input) — feeds TanStack Query
     ```
   - Stand up the `ping` procedure and confirm it round-trips renderer → preload → main → preload → renderer.
   - Install TanStack Query in the renderer, wire `callProcedure` through it as the `queryFn`/`mutationFn`.
   - Install Zustand, add one placeholder store (e.g. UI-only "active contact id") to confirm it's wired, even though nothing uses it yet.
   - **Known gap to flag forward, not solve now:** this request/response design has no built-in equivalent to tRPC's subscriptions. Phase 6 needs a streaming primitive to push `AgentEvent`s into the UI live — extend this same layer with an event-based push mechanism (e.g. `webContents.send` on a per-session channel + a matching `ipcRenderer.on` listener exposed through preload) when that phase is built, rather than reaching for a different bridge mechanism. Not needed for Phase 1's acceptance criteria.
   - Everywhere other phase docs (03–06) said "tRPC procedure" or "tRPC subscription," read it as "IPC procedure" / this layer's streaming primitive — those docs have been updated to match.

6. **Storage baseline**
   - Install `better-sqlite3` (→ `dependencies`, not `devDependencies` — ships in the packaged app; pin exact/`~`, not `^`, since it's ABI-sensitive). This is the single highest-risk item in the phase — de-risk it in isolation *before* wiring Drizzle on top:
     - The scaffold already wires `"postinstall": "electron-builder install-app-deps"` and `electron-builder.yml` already sets `npmRebuild: false` — native-module rebuild is already half set up via postinstall. Don't add `@electron/rebuild` separately unless this proves insufficient.
     - Add a throwaway one-liner in `src/main/index.ts` (`new (require('better-sqlite3'))(':memory:')`, logged), run `npm run dev`, confirm no `NODE_MODULE_VERSION` mismatch, then remove the line.
     - After `npm run build`, grep `out/main/index.js` for `better-sqlite3` to confirm it's externalized (resolved via `node_modules` at runtime) rather than bundled inline — verify electron-vite's default dependency-externalization behavior empirically, don't assume it.
   - Install Drizzle ORM + drizzle-kit. Create a throwaway schema file (e.g. one `_bootstrap_check` table, deleted in Phase 4) and confirm `drizzle-kit generate` produces real migration files (commit them — worth the small extra cost now since Phase 4 needs this discipline anyway) that `migrate()` applies at runtime against `path.join(app.getPath('userData'), 'persona-router.db')`, called before `createWindow()`.
   - No real tables yet — that's Phase 4. This step just proves the DB pipeline works end-to-end.
   - Note for packaging (step 7): the migrations folder must ship inside the packaged app (not excluded the way `src/*` normally is) — a common "works in dev, missing when packaged" gap.

7. **Packaging config**
   - electron-builder config already scaffolded (`electron-builder.yml`) — set real `appId` (e.g. `com.stevevillardi.persona-router`) in place of the placeholder, extend `asarUnpack` to include `'**/node_modules/better-sqlite3/**'` and the `drizzle/` migrations output alongside the existing `resources/**`, add `mac: { target: dir }` (skip dmg/zip/notarization — out of scope this phase, `dir` is fastest to iterate on).
   - Add the `"package": "npm run build && electron-builder --mac dir"` script (the scaffold only ships `build:mac` etc., not a plain `package` command).
   - Run it and open the resulting `.app` directly — re-verify window, button/IPC round-trip, and the DB file all work in the **packaged** context, not just `npm run dev`. This is the scenario most likely to diverge from dev given the native-module/asar risk in step 6.

## Explicitly out of scope for this phase

- Any actual UI beyond "blank window renders one shadcn Button."
- Real SQLite schema/tables.
- Any SDK (Claude/Codex/Octokit) install or auth.
- Tray/background residency (Phase 8).

## Acceptance checks

- [ ] `npm run dev` opens an Electron window with a visible shadcn `Button`.
- [ ] Clicking the button calls an IPC procedure (via the hand-rolled `ipc-contract.ts` layer) through preload → main and displays the result (proves the IPC bridge and process boundary both work).
- [ ] A SQLite file appears in the app's userData path after a dummy Drizzle migration runs — verified in both `npm run dev` and the packaged `.app`.
- [ ] `npm run lint` and `npm run typecheck` pass with zero errors on the scaffolded code, including a deliberate-bad-import test of the process-boundary rule.
- [ ] `npm run package` produces a launchable build; the packaged app's button/IPC/DB all work, not just the dev build.
- [ ] Renderer code has no direct import of anything under `src/main/` (spot-checked via `grep -rn "from ['\"].*main" src/renderer` in addition to the lint rule).

## Notes for whoever picks this up

- electron-trpc was evaluated and rejected — see the IPC bridge section above and `docs/plan/00-progress.md`'s decisions log for the full rationale/citations. Don't re-trial it without checking whether its compatibility issues have since been resolved upstream.
- Don't reach for Drizzle's full migration tooling ceremony yet beyond committing `drizzle-kit generate`'s output — Phase 4 is where the real schema and migration discipline start in earnest.
- The scaffold's actual layout is `src/main/`, `src/preload/`, `src/renderer/src/` (renderer nested one level deeper) — this is already confirmed from the template source, not a guess; use it as-is rather than restructuring.
- **shadcn/ui CLI workaround (relevant to Phase 2, which adds many more components):** `npx shadcn@latest init` cannot complete against this repo non-interactively — its framework detection doesn't recognize `electron.vite.config.ts` as a Vite project, and even with `-y`/`-d`/`-p <preset>` flags it still fails at "Verifying framework." Fix in place: a `vite.config.ts` **shim** at the repo root (not read by the app — electron-vite only reads `electron.vite.config.ts` — exists solely so shadcn's CLI can detect the project and resolve `@/*`). `components.json` is hand-authored per shadcn's documented manual-install schema (`https://ui.shadcn.com/docs/installation/manual`) rather than generated, since `init` never completes. Once `components.json` exists, `npx shadcn@latest add <component>` works normally and needs no special handling — this workaround is a one-time cost, not a per-component one. Component library choice: **Base UI** (`-b base`, package `@base-ui/react`), not Radix — keep using `-b base` for consistency when adding more components in Phase 2. Known CLI quirk: `add` sometimes writes new files to a literal `@/...` path at the repo root instead of resolving the alias (because it wasn't reading `vite.config.ts`'s alias correctly in this test) — check for a stray `@/` directory after every `add` and move the file(s) into `src/renderer/src/...` if it happens again.
- Tailwind CSS variable theme in `src/renderer/src/assets/main.css` is a placeholder neutral palette (light + dark via `prefers-color-scheme`), added only so shadcn components have working tokens to render against — Phase 2 owns the real palette/typography decisions and should treat this as a starting point to replace, not a considered design choice.
