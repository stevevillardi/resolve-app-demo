---
name: drive-app
description: Launch and drive the real Switchboard Electron app — for verifying a change in the running app (not just tests), taking screenshots, or writing/running Playwright e2e specs. Covers the e2e/fixtures.ts harness, onboarding bypass, ad-hoc driver scripts, and the build gate.
---

# Driving the app

Everything here goes through the harness in `e2e/fixtures.ts`. Do not invent a
launch path: the harness gives every instance a throwaway profile (its own
`userData`, `HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, blanked API keys) so a
run can never touch the developer's real Claude/Codex/GitHub credentials — and
so a "fresh install" assertion means something. Launching the app any other way
points it at the real profile.

## Build first — and know what the gate does

Playwright launches `out/main/index.js`, not your source. Rebuild or you are
driving the previous bundle.

- `npm run build` runs **typecheck + the unit suite** before bundling. A red
  suite means no new bundle — including a deliberate mutation you made to check
  a test has teeth, which will silently leave Playwright on the old build.
- `npx electron-vite build` bundles without the gate. Use it when iterating on
  UI you'll verify by eye, or when testing a deliberate mutation.

## Formal specs (`e2e/*.spec.ts`)

`npm run test:e2e` = build + `playwright test --project=e2e`. Screenshot specs
live behind `npm run screens`.

The fixture API (`e2e/fixtures.ts`):

- `createProfile()` / `destroyProfile(profile)` — throwaway userData dir; it
  survives `app.close()` so a relaunch can reuse it (that is how "restart the
  app" is tested).
- `launchApp(profile)` → `{ app, window, profile }`. Throws if `out/main` is
  missing.
- `invoke(window, name, input)` — calls any IPC procedure through the real
  preload bridge. The full procedure list is `src/shared/ipc-contract.ts`.
  Prefer asserting persistence through `invoke('personas.list')` etc. over
  scraping UI text.
- `waitForShell(window)` — waits for `[data-slot="sidebar"]`. Only exists after
  onboarding; on a fresh profile it times out against the splash — use
  `waitForBridge(window)` (waits for `'api' in window`) when you only need IPC.
- `closeWindow` / `destroyWindow` / `windowCount` / `anyWindowVisible` — for
  tray/background behaviour, where "the window is gone but the app runs" is the
  thing under test.
- `readProfileDb` — reads the instance's SQLite from the test process.

## Getting past onboarding

A fresh profile boots to onboarding, not the shell. The established pattern
(`e2e/guide.spec.ts`):

```ts
await waitForBridge(window)
await invoke(window, 'auth.completeOnboarding')
await app.close()
launched = await launchApp(profile)   // same profile — now lands in the shell
await waitForShell(launched.window)
```

## Ad-hoc driving (verify a change by eye)

For one-off verification, write a temporary `.mjs` driver **in the repo root**
— module resolution walks up from the script's own path, so a script in the
scratchpad cannot find `@playwright/test`. Mirror the fixtures' launch env
verbatim (profile isolation is not optional), then drive and screenshot:

```js
import { _electron as electron } from '@playwright/test'
// launch with the same args/env as e2e/fixtures.ts launchApp()
await window.getByRole('button', { name: 'Personas', exact: true }).click()
await window.screenshot({ path: `${shots}/state.png` })
```

- Nav rail buttons carry `aria-label`s from `src/renderer/src/lib/nav-items.ts`
  ('Chats', 'Personas', …). Their text labels are `display:none` while the rail
  is collapsed, so role/name queries need the aria-label, not the visible text.
- **Look at the screenshot.** Assertions prove state; only the image proves the
  layout isn't broken. A blank frame means the launch failed.
- Delete the driver script when done — it is not part of the repo.

On this project's macOS machines no xvfb is needed; in a headless container
prepend `xvfb-run -a`.

## What belongs where

- Behaviour provable through IPC + DB → unit test against the service (see the
  unit-tests skill), not an e2e spec.
- Journeys, window lifecycle, tray, onboarding, keyboard flows → `e2e/*.spec.ts`.
- "Does my change look right" → ad-hoc driver + screenshot, then throw the
  driver away.
