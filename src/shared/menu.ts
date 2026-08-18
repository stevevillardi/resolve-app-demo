/**
 * The application-menu → renderer channel (Phase 17).
 *
 * Menu items that are app features rather than OS window verbs (new contact,
 * settings, the command palette) can't run in main — the state they open lives
 * in the renderer. They send one of these ids over MENU_ACTION_CHANNEL and the
 * shell maps it onto the same store transitions the buttons use.
 *
 * In shared/ because both sides need the type, and like agent.ts it carries no
 * runtime dependency beyond string constants.
 */

export const MENU_ACTION_CHANNEL = 'menu-action'

export type MenuActionId = 'new-contact' | 'open-settings' | 'command-palette'

/**
 * The keys the application menu claims, and the only statement of them.
 *
 * They were literals inside `app-menu.ts`, which was fine while main was the
 * only reader. Home's guide is the second: it prints the app's whole shortcut
 * set, so a binding changed in the menu and not in the guide would have the
 * app advertising a key it no longer answers — and nothing would say so,
 * because the renderer may not import from `src/main` and so cannot check.
 * Shared, both sides read it, the drift is structurally impossible.
 *
 * Electron's `CmdOrCtrl+` form. The renderer rewrites the prefix for display;
 * ⌘B (the rail) and `/` (list search) are absent because they are bound in the
 * renderer, not by the menu.
 */
export const MENU_ACCELERATORS: Record<MenuActionId, string> = {
  'new-contact': 'CmdOrCtrl+N',
  'open-settings': 'CmdOrCtrl+,',
  'command-palette': 'CmdOrCtrl+K'
}

/**
 * Where "Switchboard Help" goes, and the only copy of it.
 *
 * It was written out twice — `main/app-menu.ts` for the Help menu and
 * `SettingsDialog.tsx` for the About section's link — which is one edit away
 * from the menu and the dialog sending people to different pages. Here because
 * it is the one string both processes need, same as MENU_ACTION_CHANNEL.
 */
export const DOCS_URL = 'https://github.com/stevevillardi/resolve-app-demo#readme'
