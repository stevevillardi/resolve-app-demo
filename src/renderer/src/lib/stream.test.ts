import { describe, expect, it } from 'vitest'
import { applyAgentEvent, emptyStream, streamText, type ThreadStream } from './stream'
import type { AgentEvent } from '../../../shared/agent'

function fold(events: AgentEvent[], from: ThreadStream = emptyStream): ThreadStream {
  return events.reduce(applyAgentEvent, from)
}

describe('text accumulation', () => {
  // The trap this whole split-buffer design exists for. Claude streams a block
  // delta by delta and then sends the same block again whole; appending both
  // renders every reply twice.
  it('does not double a Claude block that arrives as deltas then whole', () => {
    const stream = fold([
      { type: 'text_delta', text: 'Looks ' },
      { type: 'text_delta', text: 'good' },
      { type: 'text_delta', text: '.' },
      { type: 'text_message', text: 'Looks good.' }
    ])

    expect(streamText(stream)).toBe('Looks good.')
  })

  it('keeps successive Claude blocks in order', () => {
    const stream = fold([
      { type: 'text_delta', text: 'First.' },
      { type: 'text_message', text: 'First.' },
      { type: 'text_delta', text: ' Second.' },
      { type: 'text_message', text: ' Second.' }
    ])

    expect(streamText(stream)).toBe('First. Second.')
  })

  // Codex never emits a delta, so the fold has to work with whole messages only.
  it('accumulates Codex whole messages', () => {
    const stream = fold([
      { type: 'text_message', text: 'One.' },
      { type: 'text_message', text: ' Two.' }
    ])

    expect(streamText(stream)).toBe('One. Two.')
  })

  it('shows partial text while a block is still arriving', () => {
    const stream = fold([
      { type: 'text_message', text: 'Done block. ' },
      { type: 'text_delta', text: 'Half a' }
    ])

    expect(streamText(stream)).toBe('Done block. Half a')
  })
})

describe('done', () => {
  it('adopts finalText as authoritative', () => {
    const stream = fold([
      { type: 'text_delta', text: 'draft' },
      { type: 'done', finalText: 'The real answer.', usage: null }
    ])

    expect(streamText(stream)).toBe('The real answer.')
    expect(stream.finished).toBe(true)
  })

  // A turn can end with usage but no text — an error, or a stop. Falling back
  // to what was streamed keeps a half-written reply visible.
  it('keeps streamed text when finalText is empty', () => {
    const stream = fold([
      { type: 'text_message', text: 'Half a review' },
      { type: 'done', finalText: '', usage: null }
    ])

    expect(streamText(stream)).toBe('Half a review')
  })

  it('clears the activity line', () => {
    const stream = fold([
      { type: 'tool_start', toolCallId: 't1', name: 'Bash', detail: 'rg auth' },
      { type: 'done', finalText: 'ok', usage: null }
    ])

    expect(stream.activity).toBeNull()
  })
})

describe('tool activity', () => {
  it('prefers the detail over the bare tool name', () => {
    const stream = fold([
      { type: 'tool_start', toolCallId: 't1', name: 'Bash', detail: 'rg -l fetchStuff src/' }
    ])

    expect(stream.activity).toBe('rg -l fetchStuff src/')
  })

  it('falls back to the tool name when there is no detail', () => {
    const stream = fold([{ type: 'tool_start', toolCallId: 't1', name: 'Read' }])
    expect(stream.activity).toBe('Read')
  })

  it('updates from progress while a command runs', () => {
    const stream = fold([
      { type: 'tool_start', toolCallId: 't1', name: 'Bash', detail: 'npm test' },
      { type: 'tool_progress', toolCallId: 't1', name: 'Bash', output: '12 passing' }
    ])

    expect(stream.activity).toBe('12 passing')
  })

  it('clears when the tool ends', () => {
    const stream = fold([
      { type: 'tool_start', toolCallId: 't1', name: 'Bash', detail: 'rg auth' },
      { type: 'tool_end', toolCallId: 't1', name: 'Bash', status: 'completed' }
    ])

    expect(stream.activity).toBeNull()
  })

  it('leaves accumulated text alone', () => {
    const stream = fold([
      { type: 'text_message', text: 'Checking.' },
      { type: 'tool_start', toolCallId: 't1', name: 'Bash', detail: 'rg auth' },
      { type: 'tool_end', toolCallId: 't1', name: 'Bash', status: 'completed' }
    ])

    expect(streamText(stream)).toBe('Checking.')
  })
})

describe('errors', () => {
  it('records the kind and message', () => {
    const stream = fold([
      { type: 'error', kind: 'rate_limit', message: 'Slow down.' },
      { type: 'done', finalText: '', usage: null }
    ])

    expect(stream.error).toEqual({ kind: 'rate_limit', message: 'Slow down.' })
    expect(stream.finished).toBe(true)
  })

  // The default classifyErrorMessage() result, and the kind the renderer union
  // could not express before Phase 6 widened it.
  it('carries an unknown-kind failure through', () => {
    const stream = fold([{ type: 'error', kind: 'unknown', message: 'spawn ENOENT' }])
    expect(stream.error?.kind).toBe('unknown')
  })

  it('keeps text produced before the failure', () => {
    const stream = fold([
      { type: 'text_message', text: 'Got partway. ' },
      { type: 'error', kind: 'network', message: 'Connection reset.' },
      { type: 'done', finalText: '', usage: null }
    ])

    expect(streamText(stream)).toBe('Got partway. ')
    expect(stream.error?.kind).toBe('network')
  })
})

describe('ignored events', () => {
  it('leaves the stream untouched', () => {
    const stream = fold([
      { type: 'session_started', sessionId: 'abc' },
      { type: 'reasoning', text: 'Let me look at the imports first.' }
    ])

    expect(stream).toEqual(emptyStream)
  })
})

describe('purity', () => {
  it('does not mutate the state it was given', () => {
    const before = { ...emptyStream }
    applyAgentEvent(before, { type: 'text_delta', text: 'hi' })
    expect(before).toEqual(emptyStream)
  })
})
