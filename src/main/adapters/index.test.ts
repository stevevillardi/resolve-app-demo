import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
vi.mock('@openai/codex-sdk', () => ({ Codex: class {} }))

const { adapterFor } = await import('./index')

describe('adapterFor', () => {
  it('returns the adapter matching the persona backend', () => {
    expect(adapterFor('claude').backend).toBe('claude')
    expect(adapterFor('codex').backend).toBe('codex')
  })

  it('describes each backend by capability, not by name', () => {
    // Blueprint §3: the UI branches on what a backend can do, and the two
    // diverge in both directions rather than one being strictly richer.
    expect(adapterFor('claude').capabilities).toMatchObject({
      streamsTextDeltas: true,
      costSource: 'sdk'
    })
    expect(adapterFor('codex').capabilities).toMatchObject({
      streamsTextDeltas: false,
      costSource: 'computed'
    })
  })

  it('passes host config through to the adapter it builds', () => {
    // The Codex binary path has to survive this hop, or a packaged app falls
    // back to the SDK's require.resolve lookup and cannot find the binary.
    expect(() => adapterFor('codex', { codexBinaryPath: '/opt/codex' })).not.toThrow()
  })

  it('builds a fresh adapter per call rather than sharing one', () => {
    expect(adapterFor('claude')).not.toBe(adapterFor('claude'))
  })
})
