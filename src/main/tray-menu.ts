import type { NextRun } from './services/scheduler'

/**
 * What the tray menu says, as data.
 *
 * Pure and Electron-free so it can be tested directly — the native rendering is
 * the part that has to be looked at rather than asserted, and it belongs in the
 * phase doc's "verified live" section instead of in a mock of `Menu`.
 */

export interface TrayMenuItem {
  id: 'show' | 'quit' | 'header' | 'routine' | 'empty' | 'running' | 'more' | 'separator'
  label: string
  enabled: boolean
}

export const SHOW_LABEL = 'Show Switchboard'
export const QUIT_LABEL = 'Quit Switchboard'
const EMPTY_LABEL = 'No routines scheduled'

/**
 * At most this many routine rows. An account with thirty routines used to get
 * thirty menu rows — a tray menu taller than the screen answers nothing. The
 * overflow is counted rather than hidden, so the menu never claims the five it
 * shows are all there is.
 */
export const ROUTINE_ROWS_MAX = 5

interface TrayMenuState {
  /** Turns streaming right now — clicking the row is the same as Show. */
  runningTurns?: number
  now?: number
}

function separator(): TrayMenuItem {
  return { id: 'separator', label: '', enabled: false }
}

/**
 * Times are absolute and local, never a countdown.
 *
 * A menu is a static snapshot until something rebuilds it, so "in 12 minutes"
 * starts lying the moment it is drawn. "Tomorrow 09:00" stays true however
 * stale it gets, which is what removes any need for a refresh interval.
 * (The running-turn count does go stale the same way, but it has its own
 * rebuild trigger: the run set changing is exactly when it is redrawn.)
 */
export function buildTrayMenu(runs: NextRun[], state: TrayMenuState = {}): TrayMenuItem[] {
  const { runningTurns = 0, now = Date.now() } = state
  const items: TrayMenuItem[] = [{ id: 'show', label: SHOW_LABEL, enabled: true }]

  if (runningTurns > 0) {
    items.push({
      id: 'running',
      label: runningTurns === 1 ? '1 turn running' : `${runningTurns} turns running`,
      // Enabled and clickable (mapped to Show): "something is running" is an
      // invitation to look, not a fact to grey out.
      enabled: true
    })
  }

  items.push(separator())
  items.push({ id: 'header', label: 'Next scheduled', enabled: false })

  if (runs.length === 0) {
    // A section that renders nothing reads as a broken menu, so the empty case
    // says so out loud.
    items.push({ id: 'empty', label: EMPTY_LABEL, enabled: false })
  } else {
    for (const run of runs.slice(0, ROUTINE_ROWS_MAX)) {
      items.push({
        id: 'routine',
        label: `${describe(run.prompt)} — ${formatNextRun(run.nextRun, now)}`,
        enabled: false
      })
    }
    if (runs.length > ROUTINE_ROWS_MAX) {
      items.push({
        id: 'more',
        label: `+ ${runs.length - ROUTINE_ROWS_MAX} more scheduled`,
        enabled: false
      })
    }
  }

  items.push(separator())
  items.push({ id: 'quit', label: QUIT_LABEL, enabled: true })
  return items
}

const PROMPT_MAX = 40

function describe(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim()
  if (!collapsed) return 'Untitled routine'
  return collapsed.length > PROMPT_MAX ? `${collapsed.slice(0, PROMPT_MAX - 1)}…` : collapsed
}

export function formatNextRun(at: number | null, now: number): string {
  if (at === null) return 'not scheduled'

  const when = new Date(at)
  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const days = calendarDaysBetween(now, at)

  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  return `${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
}

/** Whole calendar days apart, so 23:59 → 00:01 reads as "tomorrow" not "today". */
function calendarDaysBetween(from: number, to: number): number {
  const start = new Date(from)
  const end = new Date(to)
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}
