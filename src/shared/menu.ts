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
 * Where "Switchboard Help" goes, and the only copy of it.
 *
 * It was written out twice — `main/app-menu.ts` for the Help menu and
 * `SettingsDialog.tsx` for the About section's link — which is one edit away
 * from the menu and the dialog sending people to different pages. Here because
 * it is the one string both processes need, same as MENU_ACTION_CHANNEL.
 */
export const DOCS_URL = 'https://github.com/stevevillardi/resolve-app-demo#readme'
