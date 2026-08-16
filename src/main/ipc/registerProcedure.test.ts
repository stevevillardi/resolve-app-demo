import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The IPC layer is the whole process boundary (blueprint §11) — if dispatch or
 * validation regresses, every phase after this one breaks in a way that only
 * shows up at runtime. These tests drive the real handler that
 * `ipcMain.handle` receives, rather than calling registered functions directly.
 */

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

const { registerProcedure, initIpc } = await import('./registerProcedure')

/** Invokes through the same single channel the preload bridge uses. */
function invoke(name: string, input?: unknown): Promise<unknown> {
  const handler = handlers.get('ipc-invoke')
  if (!handler) throw new Error('initIpc() never registered the channel')
  return Promise.resolve(handler({}, name, input))
}

beforeEach(() => {
  handlers.clear()
  initIpc()
})

describe('initIpc', () => {
  it('registers exactly one channel for every procedure', () => {
    // The design goal from Phase 1: no bespoke per-procedure preload method.
    expect([...handlers.keys()]).toEqual(['ipc-invoke'])
  })
})

describe('dispatch', () => {
  it('routes to the handler registered for the name', async () => {
    registerProcedure('ping', () => ({ message: 'pong', timestamp: 123 }))
    await expect(invoke('ping')).resolves.toEqual({ message: 'pong', timestamp: 123 })
  })

  it('awaits async handlers', async () => {
    registerProcedure('ping', async () => ({ message: 'async', timestamp: 1 }))
    await expect(invoke('ping')).resolves.toEqual({ message: 'async', timestamp: 1 })
  })

  it('rejects a name that is not in the contract', async () => {
    await expect(invoke('auth.nope')).rejects.toThrow('Unknown IPC procedure: auth.nope')
  })

  it('rejects a contract entry with no handler registered', async () => {
    // Reachable for real: a procedure added to the contract but whose module
    // was never imported for its side effect in ipc/index.ts.
    await expect(invoke('auth.getStatus')).rejects.toThrow(
      'No handler registered for IPC procedure: auth.getStatus'
    )
  })

  it('surfaces an error thrown inside a handler rather than swallowing it', async () => {
    registerProcedure('ping', () => {
      throw new Error('handler exploded')
    })
    await expect(invoke('ping')).rejects.toThrow('handler exploded')
  })
})

describe('validation', () => {
  it('rejects input that fails the contract schema', async () => {
    registerProcedure('auth.setAnthropicApiKey', () => ({ authenticated: true, source: 'api_key' }))
    // min(1) — an empty key must never reach the service and get stored.
    await expect(invoke('auth.setAnthropicApiKey', { apiKey: '' })).rejects.toThrow()
    await expect(invoke('auth.setAnthropicApiKey', {})).rejects.toThrow()
  })

  it('rejects output that fails the contract schema', async () => {
    // Guards against main quietly returning a shape the renderer's types
    // promise but the code no longer produces.
    registerProcedure('ping', () => ({ message: 'pong' }) as never)
    await expect(invoke('ping')).rejects.toThrow()
  })

  it('passes validated input through to the handler', async () => {
    const handler = vi.fn(() => ({ authenticated: true, source: 'api_key' as const }))
    registerProcedure('auth.setOpenAiApiKey', handler)
    await invoke('auth.setOpenAiApiKey', { apiKey: 'sk-test' })
    expect(handler).toHaveBeenCalledWith({ apiKey: 'sk-test' })
  })

  it('strips unknown input keys instead of forwarding them', async () => {
    const handler = vi.fn(() => ({ authenticated: true, source: 'api_key' as const }))
    registerProcedure('auth.setOpenAiApiKey', handler)
    await invoke('auth.setOpenAiApiKey', { apiKey: 'sk-test', injected: 'nope' })
    expect(handler).toHaveBeenCalledWith({ apiKey: 'sk-test' })
  })
})
