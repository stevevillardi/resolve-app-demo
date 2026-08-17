import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NavigateTarget } from '../shared/navigation'

let supported = true
const shown: FakeNotification[] = []

class FakeNotification {
  static isSupported = (): boolean => supported
  options: { title: string; body: string }
  clickHandlers: Array<() => void> = []
  showed = false

  constructor(options: { title: string; body: string }) {
    this.options = options
  }

  on(event: string, handler: () => void): void {
    if (event === 'click') this.clickHandlers.push(handler)
  }

  show(): void {
    this.showed = true
    shown.push(this)
  }
}

vi.mock('electron', () => ({ Notification: FakeNotification }))

const navigateTo = vi.fn()
let attended = false
vi.mock('./main-window', () => ({
  navigateTo: (target: NavigateTarget) => navigateTo(target),
  isWindowAttended: () => attended
}))

let enabledValue: string | null = null
vi.mock('./services/app-state', () => ({ getAppState: () => enabledValue }))

// Real contact/group lookups would pull the db chain into a test about the
// electron binding; what this file asserts is which *target* a lookup result
// produces, so the lookups are data.
let contact: { repoPath: string; displayName: string } | null = null
let group: { id: string } | null = null
vi.mock('./services/contacts', () => ({ getContact: () => contact }))
vi.mock('./services/group-messages', () => ({ groupForRepo: () => group }))

const { notificationsEnabled, notifyRoutineOutcome, notifyTurnFinished, sendNotification } =
  await import('./notifications')

const TEXT = { title: 'Refactor Buddy', body: 'Done.' }

beforeEach(() => {
  supported = true
  enabledValue = null
  attended = false
  contact = null
  group = null
  shown.length = 0
  navigateTo.mockClear()
})

describe('notificationsEnabled', () => {
  // Default ON: the unattended story is the reason notifications exist, so
  // absence of the flag must not read as opted out.
  it('is on when the flag was never written', () => {
    expect(notificationsEnabled()).toBe(true)
  })

  it('is off only for an explicit false', () => {
    enabledValue = 'false'
    expect(notificationsEnabled()).toBe(false)

    enabledValue = 'true'
    expect(notificationsEnabled()).toBe(true)
  })
})

describe('sendNotification', () => {
  it('shows with the given title and body', () => {
    sendNotification(TEXT)

    expect(shown).toHaveLength(1)
    expect(shown[0].options).toEqual(TEXT)
    expect(shown[0].showed).toBe(true)
  })

  it('stays silent when the toggle is off', () => {
    enabledValue = 'false'
    sendNotification(TEXT)
    expect(shown).toHaveLength(0)
  })

  it('stays silent on a platform with no notification support', () => {
    supported = false
    expect(() => sendNotification(TEXT)).not.toThrow()
    expect(shown).toHaveLength(0)
  })

  it('routes a click through the navigate channel', () => {
    const target: NavigateTarget = { kind: 'group', groupId: 'group-1' }
    sendNotification(TEXT, target)

    expect(shown[0].clickHandlers).toHaveLength(1)
    shown[0].clickHandlers[0]()
    expect(navigateTo).toHaveBeenCalledWith(target)
  })

  it('attaches no click handler without a target', () => {
    sendNotification(TEXT)
    expect(shown[0].clickHandlers).toHaveLength(0)
  })
})

describe('notifyRoutineOutcome', () => {
  const ROUTINE = { contactId: 'contact-1', prompt: 'Check for new issues nightly.' }
  const OK = { status: 'completed' as const, summary: 'Fixed two issues.' }

  // The routine_run row and any PR line live in the group thread — that is
  // where the click must land, not the 1:1 thread that shows neither.
  it('targets the repo group when one exists', () => {
    contact = { repoPath: '/repo', displayName: 'Nightly Sweeper' }
    group = { id: 'group-1' }

    notifyRoutineOutcome(ROUTINE, OK)

    shown[0].clickHandlers[0]()
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'group', groupId: 'group-1' })
  })

  it('falls back to the contact thread when the repo has no group', () => {
    contact = { repoPath: '/repo', displayName: 'Nightly Sweeper' }

    notifyRoutineOutcome(ROUTINE, OK)

    shown[0].clickHandlers[0]()
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'contact', contactId: 'contact-1' })
  })

  it('identifies the routine by its prompt in the body', () => {
    notifyRoutineOutcome(ROUTINE, OK)
    expect(shown[0].options.body).toContain('Check for new issues nightly.')
  })

  // A routine fire is unattended by nature — even with the app frontmost, the
  // screen the user is on does not necessarily show it.
  it('is not gated on window attention', () => {
    attended = true
    notifyRoutineOutcome(ROUTINE, OK)
    expect(shown).toHaveLength(1)
  })
})

describe('notifyTurnFinished', () => {
  const FINISHED = {
    contactId: 'contact-1',
    origin: { kind: 'message' } as const,
    finalText: 'Moved the cache.',
    error: null
  }

  beforeEach(() => {
    contact = { repoPath: '/repo', displayName: 'Refactor Buddy' }
  })

  it('notifies as a message from the persona when nobody is looking', () => {
    notifyTurnFinished(FINISHED)

    expect(shown).toHaveLength(1)
    expect(shown[0].options.title).toBe('Refactor Buddy')
    shown[0].clickHandlers[0]()
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'contact', contactId: 'contact-1' })
  })

  // The reply arriving on screen IS the notification — a toast on top of a
  // watched turn is noise.
  it('stays silent while the window is attended', () => {
    attended = true
    notifyTurnFinished(FINISHED)
    expect(shown).toHaveLength(0)
  })

  it('lands a mention turn in its group thread', () => {
    notifyTurnFinished({ ...FINISHED, origin: { kind: 'mention', groupId: 'group-9' } })

    shown[0].clickHandlers[0]()
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'group', groupId: 'group-9' })
  })

  it('does nothing for a contact deleted mid-turn', () => {
    contact = null
    expect(() => notifyTurnFinished(FINISHED)).not.toThrow()
    expect(shown).toHaveLength(0)
  })
})
