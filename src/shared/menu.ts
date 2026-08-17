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
