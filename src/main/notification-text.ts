/**
 * Notification copy, pure (Phase 20).
 *
 * Same split as tray-menu.ts / tray.ts: the words are data and get tests, the
 * electron binding beside this file stays thin. Nothing here may import
 * `electron` or the database.
 *
 * The register is iMessage's: title says who or what, body previews the
 * message. macOS shows a title and a line or two of body, so bodies are capped
 * hard rather than trusted to the OS's ellipsis.
 */

export interface NotificationText {
  title: string
  body: string
}

/** What a notification body can usefully hold — about two lines on macOS. */
export const NOTIFICATION_BODY_MAX = 160

/** Collapses whitespace and clamps; a streamed reply is paragraphs, a body is a line. */
export function previewLine(text: string, max = NOTIFICATION_BODY_MAX): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

/**
 * A routine's outcome. The body leads with the prompt preview because that is
 * the routine's name in every other surface (tray, Home, the editor list), and
 * a 3 a.m. toast that just says "finished" answers none of the questions the
 * user wakes up with.
 */
export function routineNotification(
  promptPreview: string,
  result: { status: 'completed' | 'failed' | 'skipped'; summary: string }
): NotificationText {
  const title =
    result.status === 'completed'
      ? 'Routine finished'
      : result.status === 'failed'
        ? 'Routine failed'
        : 'Routine skipped'

  // The summary already carries its own register ("Failed — …", "Skipped — …",
  // "Opened PR #12."), so the body quotes it rather than rephrasing it — one
  // account of the run, not two that can disagree.
  return { title, body: previewLine(`${promptPreview} · ${result.summary}`) }
}

/**
 * A 1:1 or mention turn that finished while nobody was looking. Styled as a
 * message from the persona — title is the sender, body previews the reply —
 * because that is exactly what it is.
 */
export function turnNotification(
  contactName: string,
  finalText: string,
  error: string | null
): NotificationText {
  if (error) {
    return { title: `${contactName} hit a problem`, body: previewLine(error) }
  }
  const body = previewLine(finalText)
  return { title: contactName, body: body || 'Finished a turn with no reply.' }
}

/**
 * A monthly budget crossing (soft alert, never enforcement).
 *
 * With unpriced turns in the month the figure is a floor, and the copy says so:
 * "at least $X" is a true statement where "$X" would be a guess dressed as a
 * total — the same honesty rule the dashboard's `$12.34+` rendering follows.
 */
export function budgetNotification(
  scopeLabel: string,
  floorUsd: number,
  budgetUsd: number,
  hasUnpriced: boolean
): NotificationText {
  const spent = `${hasUnpriced ? 'at least ' : ''}$${floorUsd.toFixed(2)}`
  return {
    title: 'Monthly budget crossed',
    body: previewLine(
      `${scopeLabel} has spent ${spent} of your $${budgetUsd.toFixed(2)} this month. Nothing has been stopped.`
    )
  }
}
