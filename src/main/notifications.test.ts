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
vi.mock('./main-window', () => ({ navigateTo: (target: NavigateTarget) => navigateTo(target) }))

let enabledValue: string | null = null
vi.mock('./services/app-state', () => ({ getAppState: () => enabledValue }))

const { notificationsEnabled, sendNotification } = await import('./notifications')

const TEXT = { title: 'Refactor Buddy', body: 'Done.' }

beforeEach(() => {
  supported = true
  enabledValue = null
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
