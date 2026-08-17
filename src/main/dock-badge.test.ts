import { describe, expect, it, vi } from 'vitest'

const setBadgeCount = vi.fn()
vi.mock('electron', () => ({ app: { setBadgeCount } }))

let total = 0
vi.mock('./services/unread', () => ({ totalUnread: () => total }))

const { refreshDockBadge } = await import('./dock-badge')

describe('refreshDockBadge', () => {
  it('sets the badge to the unread total', () => {
    total = 7
    refreshDockBadge()
    expect(setBadgeCount).toHaveBeenCalledWith(7)
  })

  // Zero must be *set*, not skipped — reading the last message has to take
  // the number off the dock, and skipping the call would leave a stale badge.
  it('clears with an explicit zero', () => {
    total = 0
    refreshDockBadge()
    expect(setBadgeCount).toHaveBeenCalledWith(0)
  })
})
