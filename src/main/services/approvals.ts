import { randomUUID } from 'crypto'
import { emitRunsChanged } from './agent-events'
import { notifyApprovalRequested } from '../notifications'
import type { ApprovalOutcome, ApprovalRequest } from '../adapters/types'

/**
 * The pending-approval registry (Phase 24, review §E1).
 *
 * An `ask_writes` persona's write arrives here as a promise the Claude
 * adapter is already awaiting inside `canUseTool` — the turn is paused by
 * construction, no polling anywhere. What this module adds around that
 * promise is everything a pause needs to be safe:
 *
 * - **A way to be seen.** A pending ask rides on `runs.list` (the renderer's
 *   existing picture of what is running) and announces itself with the same
 *   `runs-changed` push every other run-state change uses, so the card
 *   survives a renderer reload and appears for turns nobody started from a
 *   thread — a routine's ask is exactly the one that must not be invisible.
 * - **A way to end without a human.** Every ask auto-denies after
 *   APPROVAL_TIMEOUT_MS. The B5 watchdog exists because a turn holding the
 *   write lock forever is a wedge; a question nobody answers is that wedge
 *   with a nicer face. Five minutes is deliberately under the watchdog's ten,
 *   so a held ask can never read as backend silence.
 *
 * In-memory and per-process, like run-lock.ts: an approval is a live turn's
 * question, and a live turn does not survive the process either.
 */

export interface PendingApproval {
  id: string
  runId: string
  contactId: string
  toolName: string
  detail: string
  requestedAt: number
}

interface Pending extends PendingApproval {
  settle: (outcome: ApprovalOutcome) => void
  timer: NodeJS.Timeout
}

export const APPROVAL_TIMEOUT_MS = 5 * 60_000

let timeoutMs = APPROVAL_TIMEOUT_MS

/** Read per ask rather than imported, so tests can lower it — same shape as inactivity.ts. */
export function approvalTimeoutMs(): number {
  return timeoutMs
}

export function setApprovalTimeoutForTests(ms: number): void {
  timeoutMs = ms
}

const pending = new Map<string, Pending>()

/**
 * What the model reads when a human said no. Addressed to the model rather
 * than the user — the user already knows, they clicked — and explicit that a
 * silent retry is not the move, because "try again immediately" is exactly
 * what a model does with an unexplained tool failure.
 */
export function declinedReason(detail: string): string {
  return `The user declined to approve this: ${detail}. Do not retry it unless they ask you to.`
}

/** No answer is an answer, and the model is told which kind. */
export function timedOutReason(detail: string, ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return (
    `Nobody answered the approval request for this within ${minutes} ` +
    `minute${minutes === 1 ? '' : 's'}, so it was refused: ${detail}. ` +
    'The user can approve it later if you ask again.'
  )
}

/**
 * Holds one write for a decision. Resolves with the human's answer, the
 * timeout's, or the turn teardown's — exactly one of them, exactly once.
 */
export function requestApproval(
  runId: string,
  contactId: string,
  request: ApprovalRequest
): Promise<ApprovalOutcome> {
  const id = randomUUID()

  return new Promise<ApprovalOutcome>((resolve) => {
    const entry: Pending = {
      id,
      runId,
      contactId,
      toolName: request.toolName,
      detail: request.detail,
      requestedAt: Date.now(),
      settle: resolve,
      timer: setTimeout(
        () => settle(id, { approved: false, reason: timedOutReason(request.detail, timeoutMs) }),
        timeoutMs
      )
    }
    pending.set(id, entry)

    // After the registry write, so the refetch this triggers can see the ask.
    emitRunsChanged()
    notifyApprovalRequested(contactId, request)
  })
}

/** Removes and settles one entry. The single exit — every path ends here. */
function settle(id: string, outcome: ApprovalOutcome): boolean {
  const entry = pending.get(id)
  if (!entry) return false

  pending.delete(id)
  clearTimeout(entry.timer)
  entry.settle(outcome)
  emitRunsChanged()
  return true
}

/**
 * The human's click. False when the ask is already gone — answered on another
 * surface, timed out, or the turn ended — which the caller reports as a stale
 * click rather than an error.
 *
 * `runId` is checked as well as the id so a stale approval card, holding ids
 * from a turn that has since ended, cannot answer a *new* turn's question.
 */
export function resolveApproval(runId: string, approvalId: string, approved: boolean): boolean {
  const entry = pending.get(approvalId)
  if (!entry || entry.runId !== runId) return false

  return settle(
    approvalId,
    approved
      ? { approved: true, reason: '' }
      : { approved: false, reason: declinedReason(entry.detail) }
  )
}

/**
 * The oldest unanswered ask for a run, for `runs.list`. Oldest rather than
 * newest because canUseTool holds calls in the order they were made — the
 * first one asked is the one the turn is actually waiting on.
 */
export function approvalFor(runId: string): PendingApproval | null {
  let oldest: Pending | null = null
  for (const entry of pending.values()) {
    if (entry.runId !== runId) continue
    if (!oldest || entry.requestedAt < oldest.requestedAt) oldest = entry
  }
  if (!oldest) return null

  const { id, contactId, toolName, detail, requestedAt } = oldest
  return { id, runId, contactId, toolName, detail, requestedAt }
}

/**
 * Denies whatever a finished turn left unanswered. Called from the turn's
 * teardown so an abort mid-ask cannot leave the adapter's promise pending
 * forever — the reason is for form's sake, since the turn it would inform is
 * already over.
 */
export function cancelApprovalsFor(runId: string): void {
  for (const entry of [...pending.values()]) {
    if (entry.runId !== runId) continue
    settle(entry.id, {
      approved: false,
      reason: 'The turn ended before this approval was answered.'
    })
  }
}
