import { notifyRoutineOutcome } from '../notifications'
import { runRoutineTurn } from './messaging'
import { openPullRequest, pullRequestState } from './pull-requests'
import {
  getRoutine,
  listEnabledRoutines,
  listRoutines,
  recordMissedRun,
  recordRunOutcome
} from './routines'
import type { TurnOutcome } from './turn-origin'

/**
 * The scheduler (blueprint §7, §15E).
 *
 * Built in-app rather than on any vendor's native scheduling, per §7's warning
 * about Codex's cloud-only scheduling. node-cron holds the timers; this module
 * holds the policy.
 *
 * Two properties worth understanding before editing:
 *
 * **`fireRoutine` is the only path.** A scheduled tick and the "Run now" button
 * both land here, with no branch between them — the blueprint calls out that
 * equivalence as something to be able to state truthfully if asked, so it is
 * structural rather than a convention. The tests assert it by checking both
 * entry points against one shared expectation helper.
 *
 * **The engine is a port.** Everything interesting is testable without a second
 * of wall-clock time passing, which is the same division `adapter-host.ts` uses
 * to keep the adapters drivable outside Electron.
 */

/** The slice of a cron engine this service uses. node-cron implements it; tests fake it. */
export interface CronEngine {
  /**
   * `onMissed` reports a fire the engine skipped outright (a late wake past
   * its tolerance). Optional on the port because a caller with no miss policy
   * is legitimate; the scheduler always passes one, and the engine forwards
   * the slot's own date so the record says when the fire *should* have been.
   */
  schedule(
    expression: string,
    onTick: () => void,
    name: string,
    onMissed?: (date: Date) => void
  ): CronHandle
}

export interface CronHandle {
  destroy(): void
  getNextRun(): Date | null
}

export type RoutineRunStatus = 'completed' | 'failed' | 'skipped'

export interface RoutineRunResult {
  status: RoutineRunStatus
  summary: string
}

export interface RoutineFire {
  /** Null when the turn never started — refused by the lock, or the routine is gone. */
  runId: string | null
  /** Settles when the routine's bookkeeping is written. Never rejects. */
  completed: Promise<RoutineRunResult>
}

interface Armed {
  handle: CronHandle
  expression: string
}

const armed = new Map<string, Armed>()
const inFlight = new Set<string>()

let engine: CronEngine | null = null
let onChange: (() => void) | null = null

/**
 * A routine's lastRunSummary is a subtitle in a list, so it is capped rather
 * than storing a whole reply. The summariser's sentence is preferred over this
 * whenever there is one.
 */
const SUMMARY_MAX = 200

// --- Lifecycle --------------------------------------------------------------

/**
 * Arms every enabled routine and starts firing.
 *
 * Called from `app.whenReady()` *before* the window is created, because not
 * depending on a window is the entire point of the phase.
 */
export function startScheduler(cronEngine: CronEngine, notifyChange?: () => void): void {
  engine = cronEngine
  onChange = notifyChange ?? null
  syncSchedules()
}

/** Destroys every timer. Called from `before-quit` and from test teardown. */
export function stopScheduler(): void {
  for (const { handle } of armed.values()) handle.destroy()
  armed.clear()
  inFlight.clear()
  engine = null
  onChange = null
}

/**
 * Brings the armed set in line with the table.
 *
 * Diffs rather than rebuilds: re-creating every task on any change would re-arm
 * unrelated timers and churn on each keystroke-sized edit. An unchanged
 * expression keeps its existing handle, so its next fire time does not move
 * because something else was edited.
 *
 * One bad row must not take the scheduler down with it — an invalid expression
 * is skipped and logged, and every other routine still arms.
 */
export function syncSchedules(): void {
  if (!engine) return

  const wanted = new Map(listEnabledRoutines().map((routine) => [routine.id, routine]))

  for (const [id, entry] of armed) {
    const routine = wanted.get(id)
    if (!routine || routine.schedule !== entry.expression) {
      entry.handle.destroy()
      armed.delete(id)
    }
  }

  for (const [id, routine] of wanted) {
    if (armed.has(id)) continue
    try {
      // Closes over the id only, never a snapshot: fireRoutine re-reads from
      // SQLite, so an edited prompt takes effect on the next fire and a routine
      // deleted between arming and firing simply no-ops. A miss is recorded to
      // the row (the counter must survive re-arming, which destroys handles)
      // and announced, so the tray and the renderer both learn without a fire.
      const handle = engine.schedule(
        routine.schedule,
        () => void fireRoutine(id).completed,
        id,
        (date) => {
          recordMissedRun(id, date.getTime())
          onChange?.()
        }
      )
      armed.set(id, { handle, expression: routine.schedule })
    } catch (error) {
      console.error(`[scheduler] could not arm routine ${id}`, error)
    }
  }

  onChange?.()
}

// --- Firing -----------------------------------------------------------------

/**
 * Runs one routine. The single path, shared by cron and by "Run now".
 *
 * Synchronous at the start, mirroring `startTurn`, so the IPC procedure behind
 * the button can hand back a runId immediately and let the reply stream — a
 * turn can take minutes, which is far too long to hold an invoke open.
 */
export function fireRoutine(routineId: string): RoutineFire {
  const routine = getRoutine(routineId)
  if (!routine) {
    return settled({ status: 'skipped', summary: 'Routine no longer exists.' })
  }

  // Deliberately not gated on `enabled`: syncSchedules never arms a disabled
  // routine, so cron cannot reach here for one — while "Run now" is a manual
  // override and has to work on a paused routine, which is how you test one
  // before turning it on.
  if (inFlight.has(routineId)) {
    // Not recorded: a fire that never started is not an attempt, and stamping
    // lastRunAt here would overwrite the run that is still going.
    console.warn(`[scheduler] routine ${routineId} fired while its previous run was still going`)
    return settled({ status: 'skipped', summary: 'Already running.' })
  }

  let turn: { runId: string; completed: Promise<TurnOutcome> }
  try {
    turn = runRoutineTurn(routineId, routine.contactId, routine.prompt)
  } catch (error) {
    // Where a run-lock refusal lands. The message is already phrased to name
    // the holder ("Refactor Buddy is already working in this repo…"), so it is
    // recorded as-is rather than flattened into "skipped". A writing routine
    // colliding with the repo a user is working in is the first contention in
    // the product that nobody is watching for — it must leave a trace.
    const summary = `Skipped — ${messageOf(error)}`
    recordRunOutcome(routineId, summary)
    onChange?.()
    notifyRoutineOutcome(routine, { status: 'skipped', summary })
    return settled({ status: 'skipped', summary })
  }

  inFlight.add(routineId)
  const completed = turn.completed.then(async (outcome) => {
    inFlight.delete(routineId)
    const result = resultOf(outcome)

    // Recorded before the pull request is attempted, and again afterwards if
    // there is anything to add. GitHub is a network call with no deadline of
    // its own; holding the run's own bookkeeping behind it would leave a fire
    // that plainly happened looking like it never did.
    recordRunOutcome(routineId, result.summary)
    onChange?.()
    // Sent with the run's own summary, not held for the PR attempt below —
    // GitHub is a network call with no deadline, and the same reasoning that
    // splits recordRunOutcome applies to the toast. The PR line still lands in
    // lastRunSummary and the group thread, one click away.
    notifyRoutineOutcome(routine, result)

    const pr = await raisePullRequest(routine.contactId, result)
    if (pr) {
      recordRunOutcome(routineId, `${result.summary} ${pr}`.trim())
      onChange?.()
    }

    return result
  })

  return { runId: turn.runId, completed }
}

/**
 * The pull request at the end of a routine run (blueprint §16 Journey 3).
 *
 * Blueprint §9 says a remote action is "an explicit action... not an automatic
 * side effect", and this looks like the exception. It isn't: the explicit act is
 * setting up the routine — choosing a persona with `open_pr`, writing the
 * prompt, enabling the schedule — rather than a click per fire. Nobody is
 * watching a 3am run, so requiring a click there would mean the work simply sits
 * on a branch nobody knows about, which is the failure this whole phase exists
 * to prevent. What stays true is the bound: a PR, never a push to the default
 * branch, and never a merge.
 *
 * Runs after the lock is released and after the summariser has settled, so the
 * body can quote the persona's own account of what it did.
 *
 * Every failure is folded into the run's summary rather than raised. A routine
 * that did its work and could not open a pull request has still done its work —
 * failing the run would misreport that, and there is nobody at the screen to
 * tell either way. The refusals are legible on purpose: "left 2 uncommitted
 * changes", "has a read_only GitHub scope".
 */
async function raisePullRequest(
  contactId: string,
  result: RoutineRunResult
): Promise<string | null> {
  if (result.status !== 'completed') return null

  try {
    const { available } = await pullRequestState(contactId)
    // Not an error worth reporting: most Contacts have no pull-request path at
    // all, and a routine on one is the normal case rather than a misconfiguration.
    if (!available) return null

    const pr = await openPullRequest(contactId)
    return pr.action === 'created' ? `Opened PR #${pr.number}.` : `Commented on PR #${pr.number}.`
  } catch (error) {
    return `Could not open a pull request: ${messageOf(error)}`
  }
}

/**
 * Reads a finished turn as a routine outcome.
 *
 * The summariser's sentence is preferred whenever there is one — it already ran
 * as part of the turn, so using it costs nothing, whereas asking a model again
 * for a list subtitle would double the price of every routine.
 */
function resultOf(outcome: TurnOutcome): RoutineRunResult {
  if (outcome.error) return { status: 'failed', summary: `Failed — ${outcome.error}` }

  const text = outcome.summary?.summary ?? preview(outcome.finalText)
  if (outcome.aborted) return { status: 'completed', summary: `Stopped. ${text}`.trim() }
  if (!text) return { status: 'completed', summary: 'Ran, but produced no reply.' }
  return { status: 'completed', summary: text }
}

function preview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > SUMMARY_MAX ? `${collapsed.slice(0, SUMMARY_MAX - 1)}…` : collapsed
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function settled(result: RoutineRunResult): RoutineFire {
  return { runId: null, completed: Promise.resolve(result) }
}

// --- Reads ------------------------------------------------------------------

export interface NextRun {
  routineId: string
  prompt: string
  /** Epoch ms, or null when the engine cannot say — a disabled or unarmed routine. */
  nextRun: number | null
}

/**
 * What the tray menu lists.
 *
 * Only armed routines appear: a disabled one is never scheduled, so reporting a
 * next-fire time for it would be a lie the menu tells every time it opens.
 */
export function nextRuns(): NextRun[] {
  const byId = new Map(listRoutines().map((routine) => [routine.id, routine]))

  return [...armed.entries()]
    .map(([id, entry]) => ({
      routineId: id,
      prompt: byId.get(id)?.prompt ?? '',
      nextRun: entry.handle.getNextRun()?.getTime() ?? null
    }))
    .sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity))
}

/** Test-only: the ids currently armed. */
export function armedRoutineIds(): string[] {
  return [...armed.keys()]
}
