import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { AgentEvent } from '../../shared/agent'

interface FakeWindow {
  destroyed: boolean
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
}

let windows: FakeWindow[] = []

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windows }
}))

const { emitAgentEvent, emitRunsChanged } = await import('./agent-events')
const { AGENT_EVENT_CHANNEL } = await import('../../shared/agent')

function fakeWindow(destroyed = false): FakeWindow {
  return {
    destroyed,
    isDestroyed(): boolean {
      return this.destroyed
    },
    webContents: { send: vi.fn() }
  }
}

const TEXT: AgentEvent = { type: 'text_delta', text: 'hello' }

beforeEach(() => {
  windows = []
})

describe('emitAgentEvent', () => {
  it('sends the event wrapped with its runId', () => {
    const window = fakeWindow()
    windows = [window]

    emitAgentEvent('run-1', TEXT)

    expect(window.webContents.send).toHaveBeenCalledWith(AGENT_EVENT_CHANNEL, {
      kind: 'event',
      runId: 'run-1',
      event: TEXT
    })
  })

  it('does nothing when there is no window', () => {
    expect(() => emitAgentEvent('run-1', TEXT)).not.toThrow()
  })

  // The window can go away mid-turn — the user closes it while a model is still
  // talking. Sending to a destroyed window throws, which would escape into the
  // run loop and abort a turn that was otherwise fine.
  it('skips destroyed windows', () => {
    const destroyed = fakeWindow(true)
    windows = [destroyed]

    emitAgentEvent('run-1', TEXT)

    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })

  it('prefers a live window over a destroyed one', () => {
    const destroyed = fakeWindow(true)
    const live = fakeWindow()
    windows = [destroyed, live]

    emitAgentEvent('run-1', TEXT)

    expect(destroyed.webContents.send).not.toHaveBeenCalled()
    expect(live.webContents.send).toHaveBeenCalledOnce()
  })

  // Same guarantee registerProcedure() gives outputs: a malformed push fails
  // here, next to the code that built it, rather than as a type error in a
  // component three layers away.
  it('rejects an event that is not in the union', () => {
    windows = [fakeWindow()]

    expect(() =>
      emitAgentEvent('run-1', { type: 'not_a_real_event' } as unknown as AgentEvent)
    ).toThrow()
  })

  it('carries every event type through, including the terminal one', () => {
    const window = fakeWindow()
    windows = [window]

    const done: AgentEvent = { type: 'done', finalText: 'bye', usage: null }
    emitAgentEvent('run-1', done)

    expect(window.webContents.send).toHaveBeenCalledWith(AGENT_EVENT_CHANNEL, {
      kind: 'event',
      runId: 'run-1',
      event: done
    })
  })
})

describe('emitRunsChanged', () => {
  it('sends a payload-free notification', () => {
    const window = fakeWindow()
    windows = [window]

    emitRunsChanged()

    expect(window.webContents.send).toHaveBeenCalledWith(AGENT_EVENT_CHANNEL, {
      kind: 'runs-changed'
    })
  })

  it('does nothing when there is no window', () => {
    expect(() => emitRunsChanged()).not.toThrow()
  })
})
