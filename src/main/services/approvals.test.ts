import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const emitted = vi.hoisted(() => ({ runsChanged: 0 }))
const notified = vi.hoisted(() => ({ calls: [] as { contactId: string; detail: string }[] }))

vi.mock('./agent-events', () => ({
  emitRunsChanged: () => {
    emitted.runsChanged += 1
  }
}))

vi.mock('../notifications', () => ({
  notifyApprovalRequested: (contactId: string, request: { toolName: string; detail: string }) => {
    notified.calls.push({ contactId, detail: request.detail })
  }
}))

import {
  APPROVAL_TIMEOUT_MS,
  approvalFor,
  cancelApprovalsFor,
  requestApproval,
  resolveApproval,
  setApprovalTimeoutForTests
} from './approvals'

/**
 * The registry is what makes the ask_writes pause safe: it must always settle
 * (a human, the timeout, or the turn teardown), and every path out must be
 * visible to the renderer. Tested from those claims — each case drives the
 * promise the adapter would actually be awaiting.
 */

describe('the approval registry', () => {
  beforeEach(() => {
    emitted.runsChanged = 0
    notified.calls.length = 0
    setApprovalTimeoutForTests(APPROVAL_TIMEOUT_MS)
  })

  afterEach(() => {
    // Every test settles what it opened, so state cannot leak between cases.
    cancelApprovalsFor('run-1')
    cancelApprovalsFor('run-2')
  })

  it('resolves the held promise with the approval when a human says yes', async () => {
    const held = requestApproval('run-1', 'contact-1', { toolName: 'Write', detail: 'a.ts' })
    const ask = approvalFor('run-1')
    expect(ask).not.toBeNull()

    expect(resolveApproval('run-1', ask!.id, true)).toBe(true)
    await expect(held).resolves.toEqual({ approved: true, reason: '' })
    expect(approvalFor('run-1')).toBeNull()
  })

  it('a no carries the detail and tells the model not to retry on its own', async () => {
    const held = requestApproval('run-1', 'contact-1', {
      toolName: 'Bash',
      detail: 'npm version patch'
    })
    resolveApproval('run-1', approvalFor('run-1')!.id, false)

    const outcome = await held
    expect(outcome.approved).toBe(false)
    expect(outcome.reason).toContain('npm version patch')
    expect(outcome.reason).toContain('declined')
    expect(outcome.reason.toLowerCase()).toContain('do not retry')
  })

  it('auto-denies an unanswered ask, and says it was the clock, not the user', async () => {
    setApprovalTimeoutForTests(20)
    const held = requestApproval('run-1', 'contact-1', { toolName: 'Edit', detail: 'b.ts' })

    const outcome = await held
    expect(outcome.approved).toBe(false)
    expect(outcome.reason).toContain('Nobody answered')
    expect(outcome.reason).toContain('b.ts')
    // The registry forgot it, so a late click is stale rather than an answer.
    expect(approvalFor('run-1')).toBeNull()
  })

  it('refuses a stale or cross-run click', async () => {
    const held = requestApproval('run-1', 'contact-1', { toolName: 'Write', detail: 'a.ts' })
    const ask = approvalFor('run-1')!

    // A card holding this id but rendered under another turn must not answer.
    expect(resolveApproval('run-2', ask.id, true)).toBe(false)
    expect(resolveApproval('run-1', 'no-such-ask', true)).toBe(false)

    expect(resolveApproval('run-1', ask.id, false)).toBe(true)
    // The second answer is too late, whatever it says.
    expect(resolveApproval('run-1', ask.id, true)).toBe(false)
    await expect(held).resolves.toMatchObject({ approved: false })
  })

  it('surfaces the oldest ask for a run, which is the one the turn is waiting on', () => {
    void requestApproval('run-1', 'contact-1', { toolName: 'Write', detail: 'first' })
    void requestApproval('run-1', 'contact-1', { toolName: 'Write', detail: 'second' })
    void requestApproval('run-2', 'contact-2', { toolName: 'Write', detail: 'other run' })

    expect(approvalFor('run-1')?.detail).toBe('first')
    expect(approvalFor('run-2')?.detail).toBe('other run')
  })

  it('denies everything a finished turn left open, and only that turn', async () => {
    const mine = requestApproval('run-1', 'contact-1', { toolName: 'Write', detail: 'mine' })
    const other = requestApproval('run-2', 'contact-2', { toolName: 'Write', detail: 'other' })

    cancelApprovalsFor('run-1')
    await expect(mine).resolves.toMatchObject({ approved: false })
    expect(approvalFor('run-1')).toBeNull()

    // The sibling run's ask is untouched — still pending, still answerable.
    expect(approvalFor('run-2')).not.toBeNull()
    resolveApproval('run-2', approvalFor('run-2')!.id, true)
    await expect(other).resolves.toMatchObject({ approved: true })
  })

  it('announces on runs-changed at both ends, so the card appears and disappears', async () => {
    const held = requestApproval('run-1', 'contact-1', { toolName: 'Write', detail: 'a.ts' })
    expect(emitted.runsChanged).toBe(1)

    resolveApproval('run-1', approvalFor('run-1')!.id, true)
    await held
    expect(emitted.runsChanged).toBe(2)
  })

  it('sends the OS notification with the contact and the act', async () => {
    const held = requestApproval('run-1', 'contact-9', { toolName: 'Bash', detail: 'npm publish' })
    expect(notified.calls).toEqual([{ contactId: 'contact-9', detail: 'npm publish' }])
    resolveApproval('run-1', approvalFor('run-1')!.id, false)
    await held
  })
})
