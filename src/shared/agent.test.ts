import { describe, expect, it } from 'vitest'
import { agentCapabilitiesSchema, agentEventSchema, agentUsageSchema } from './agent'

/**
 * These schemas cross the process boundary in Phase 6, where main pushes
 * events to the renderer — so they are validated for the same reason the IPC
 * contract is, and the enum members are asserted because a typo in one would
 * only show up as a dropped event at runtime.
 */

describe('agentEventSchema', () => {
  it('accepts every event the adapters emit', () => {
    const events = [
      { type: 'session_started', sessionId: 's' },
      { type: 'text_delta', text: 'a' },
      { type: 'text_message', text: 'a' },
      { type: 'reasoning', text: 'a' },
      { type: 'tool_start', toolCallId: 't', name: 'Bash' },
      { type: 'tool_progress', toolCallId: 't', name: 'Bash' },
      { type: 'tool_end', toolCallId: 't', name: 'Bash', status: 'completed' },
      { type: 'error', kind: 'rate_limit', message: 'slow down' },
      { type: 'done', finalText: 'a', usage: null }
    ]
    for (const event of events) {
      expect(agentEventSchema.safeParse(event).success, event.type).toBe(true)
    }
  })

  it('rejects an unknown event type rather than passing it through', () => {
    expect(agentEventSchema.safeParse({ type: 'telepathy', text: 'a' }).success).toBe(false)
  })

  it('requires the fields a consumer would otherwise read as undefined', () => {
    expect(agentEventSchema.safeParse({ type: 'tool_start', name: 'Bash' }).success).toBe(false)
    expect(agentEventSchema.safeParse({ type: 'session_started' }).success).toBe(false)
    expect(agentEventSchema.safeParse({ type: 'done', finalText: 'a' }).success).toBe(false)
  })

  it('only allows completed or failed as a tool_end status', () => {
    expect(
      agentEventSchema.safeParse({
        type: 'tool_end',
        toolCallId: 't',
        name: 'B',
        status: 'in_progress'
      }).success
    ).toBe(false)
  })

  it('covers every kind the renderer error bubble distinguishes', () => {
    // MessageBubbleError['kind'] is rate_limit | sandbox_denied | network;
    // Phase 6 maps straight across, so those three must stay valid here.
    for (const kind of ['rate_limit', 'sandbox_denied', 'network', 'auth', 'unknown']) {
      expect(agentEventSchema.safeParse({ type: 'error', kind, message: 'x' }).success, kind).toBe(
        true
      )
    }
    expect(agentEventSchema.safeParse({ type: 'error', kind: 'vibes', message: 'x' }).success).toBe(
      false
    )
  })
})

describe('agentUsageSchema', () => {
  it('accepts a null cost, which is how an unpriced model reports', () => {
    const usage = { inputTokens: 1, outputTokens: 2, costUsd: null, costSource: 'computed' }
    expect(agentUsageSchema.safeParse(usage).success).toBe(true)
  })

  it('requires the cost source, since sdk and computed are not comparable', () => {
    expect(
      agentUsageSchema.safeParse({ inputTokens: 1, outputTokens: 2, costUsd: 0 }).success
    ).toBe(false)
    expect(
      agentUsageSchema.safeParse({
        inputTokens: 1,
        outputTokens: 2,
        costUsd: 0,
        costSource: 'vibes'
      }).success
    ).toBe(false)
  })

  it('lines up with the fields a UsageEvent row stores', () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 20,
      cachedInputTokens: 5,
      costUsd: 0.01,
      costSource: 'sdk' as const
    }
    const parsed = agentUsageSchema.parse(usage)
    expect(parsed.inputTokens).toBe(10)
    expect(parsed.cachedInputTokens).toBe(5)
  })
})

describe('agentCapabilitiesSchema', () => {
  it('accepts the two genuinely different backend shapes', () => {
    expect(
      agentCapabilitiesSchema.safeParse({
        streamsTextDeltas: true,
        streamsToolProgress: true,
        costSource: 'sdk',
        sandboxEnforcement: 'os'
      }).success
    ).toBe(true)
    expect(
      agentCapabilitiesSchema.safeParse({
        streamsTextDeltas: false,
        streamsToolProgress: true,
        costSource: 'computed',
        sandboxEnforcement: 'os'
      }).success
    ).toBe(true)
  })

  it('requires enforcement to be stated, not left to be assumed', () => {
    // The whole reason this field exists is that "read-only" meant two
    // different things per backend without anyone saying so. A capabilities
    // object that omits it must not parse.
    expect(
      agentCapabilitiesSchema.safeParse({
        streamsTextDeltas: true,
        streamsToolProgress: true,
        costSource: 'sdk'
      }).success
    ).toBe(false)
  })
})
