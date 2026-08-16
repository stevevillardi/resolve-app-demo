import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../shared/agent'
import type { PersonaTemplate } from '../../shared/domain'
import type { SessionSpec } from './types'

/**
 * Normalization is asserted against message shapes captured from real runs
 * (see docs/plan/05-backend-adapters.md), so the mapping is tested without
 * spending anything. The live half — that a turn actually streams and that a
 * denied write really leaves the disk untouched — is recorded in that doc.
 */

const query = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (args: unknown) => query(args) }))

const { classifyClaudeError, createClaudeAdapter, toolDetail, usageFromResult } =
  await import('./claude')

const PERSONA: PersonaTemplate = {
  id: 'p1',
  name: 'Reviewer',
  avatarColor: '#000',
  backend: 'claude',
  model: null,
  systemPrompt: 'You review code.',
  skillIds: [],
  sandbox: 'read_only',
  githubScope: 'read_only'
}

const SPEC: SessionSpec = { persona: PERSONA, repoPath: '/tmp/repo', skills: [] }

interface ModelUsageEntry {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
  // The SDK sends more than the adapter reads; kept so the fixture stays a
  // faithful copy of a real result rather than a trimmed one.
  webSearchRequests?: number
  contextWindow?: number
  maxOutputTokens?: number
}

/** The single-model shape every real result message has had. */
function modelUsage(overrides: Record<string, number> = {}): Record<string, ModelUsageEntry> {
  return {
    'claude-haiku-4-5-20251001': {
      inputTokens: 591,
      outputTokens: 1045,
      cacheReadInputTokens: 67854,
      cacheCreationInputTokens: 1845,
      webSearchRequests: 0,
      costUSD: 0.0162914,
      contextWindow: 200000,
      maxOutputTokens: 32000,
      ...overrides
    }
  }
}

function mockStream(messages: unknown[]): void {
  query.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    }
  })
}

async function collect(
  messages: unknown[],
  sessionId: string | null = null
): Promise<AgentEvent[]> {
  mockStream(messages)
  const adapter = createClaudeAdapter()
  const session = sessionId ? adapter.resume(SPEC, sessionId) : adapter.createSession(SPEC)
  const events: AgentEvent[] = []
  for await (const event of adapter.run(session, 'go')) events.push(event)
  return events
}

beforeEach(() => {
  query.mockReset()
})

describe('toolDetail', () => {
  it('prefers the field that says what the call will do', () => {
    expect(toolDetail({ command: 'git diff' })).toBe('git diff')
    expect(toolDetail({ file_path: '/a/b.ts' })).toBe('/a/b.ts')
    expect(toolDetail({ notebook_path: '/a/b.ipynb' })).toBe('/a/b.ipynb')
    expect(toolDetail({ pattern: 'TODO' })).toBe('TODO')
  })

  it('is empty rather than undefined when there is nothing to say', () => {
    expect(toolDetail(undefined)).toBe('')
    expect(toolDetail({ unrelated: 1 })).toBe('')
  })
})

describe('classifyClaudeError', () => {
  it('maps the SDK codes the renderer styles differently', () => {
    expect(classifyClaudeError('rate_limit')).toBe('rate_limit')
    expect(classifyClaudeError('overloaded')).toBe('rate_limit')
    expect(classifyClaudeError('authentication_failed')).toBe('auth')
    expect(classifyClaudeError('billing_error')).toBe('auth')
    expect(classifyClaudeError('server_error')).toBe('network')
  })

  it('falls back to unknown for codes it has not seen', () => {
    expect(classifyClaudeError('max_output_tokens')).toBe('unknown')
    expect(classifyClaudeError(undefined)).toBe('unknown')
  })
})

describe('usageFromResult', () => {
  it('reads modelUsage rather than summing assistant messages', () => {
    const usage = usageFromResult({ total_cost_usd: 0.0162914, modelUsage: modelUsage() })
    expect(usage).toEqual({
      inputTokens: 591,
      outputTokens: 1045,
      cachedInputTokens: 67854,
      cacheWriteInputTokens: 1845,
      costUsd: 0.0162914,
      costSource: 'sdk',
      model: 'claude-haiku-4-5-20251001'
    })
  })

  it('sums across models when a turn used more than one', () => {
    const usage = usageFromResult({
      total_cost_usd: 1,
      modelUsage: {
        main: {
          inputTokens: 100,
          outputTokens: 200,
          cacheReadInputTokens: 10,
          cacheCreationInputTokens: 1,
          costUSD: 0.5
        },
        subagent: {
          inputTokens: 50,
          outputTokens: 25,
          cacheReadInputTokens: 5,
          cacheCreationInputTokens: 2,
          costUSD: 0.5
        }
      }
    })
    expect(usage?.inputTokens).toBe(150)
    expect(usage?.outputTokens).toBe(225)
    expect(usage?.cachedInputTokens).toBe(15)
    expect(usage?.cacheWriteInputTokens).toBe(3)
    // Named after whichever model actually generated the most.
    expect(usage?.model).toBe('main')
  })

  it('returns null when the result carries no modelUsage at all', () => {
    // Crash and startup-error results can come back zeroed; reporting null
    // beats reporting a confident zero.
    expect(usageFromResult({ total_cost_usd: 0 })).toBeNull()
    expect(usageFromResult({ modelUsage: {} })).toBeNull()
  })

  it('reports a null cost when the SDK omitted one', () => {
    expect(usageFromResult({ modelUsage: modelUsage() })?.costUsd).toBeNull()
  })
})

describe('stream normalization', () => {
  it('reports the session id from the init message', async () => {
    const events = await collect([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      { type: 'result', subtype: 'success', result: 'hi', modelUsage: modelUsage() }
    ])
    expect(events[0]).toEqual({ type: 'session_started', sessionId: 'sess-1' })
  })

  it('writes the session id back onto the session, for Contact.backendSessionId', async () => {
    mockStream([{ type: 'system', subtype: 'init', session_id: 'sess-2' }])
    const adapter = createClaudeAdapter()
    const session = adapter.createSession(SPEC)
    expect(session.sessionId).toBeNull()
    for await (const _ of adapter.run(session, 'go')) void _
    expect(session.sessionId).toBe('sess-2')
  })

  it('passes the prior session id to the SDK as resume', async () => {
    await collect([], 'sess-old')
    expect(query.mock.calls[0][0].options.resume).toBe('sess-old')
  })

  it('omits resume entirely on a fresh session', async () => {
    await collect([])
    expect(query.mock.calls[0][0].options).not.toHaveProperty('resume')
  })

  it('turns text deltas into text_delta and whole blocks into text_message', async () => {
    const events = await collect([
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'he' } }
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'llo' } }
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }
    ])
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: 'he' },
      { type: 'text_delta', text: 'llo' }
    ])
    expect(events).toContainEqual({ type: 'text_message', text: 'hello' })
  })

  it('emits the same text twice, as deltas AND as a whole message', async () => {
    // Pinned deliberately, because it is the shape most likely to be misread
    // downstream: the deltas and the message OVERLAP, they do not concatenate.
    // A consumer that appends both renders every reply doubled. See the note on
    // text_message in src/shared/agent.ts.
    const events = await collect([
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } },
      { type: 'result', subtype: 'success', result: 'hello' }
    ])

    const deltas = events.filter((e) => e.type === 'text_delta')
    const messages = events.filter((e) => e.type === 'text_message')
    expect(deltas.map((e) => e.text).join('')).toBe('hello')
    expect(messages.map((e) => e.text).join('')).toBe('hello')

    // And the thing to actually persist is neither of the two streams.
    const done = events.find((e) => e.type === 'done')
    expect(done && done.type === 'done' && done.finalText).toBe('hello')
  })

  it('ignores stream events that are not text deltas', async () => {
    const events = await collect([
      { type: 'stream_event', event: { type: 'content_block_start' } },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'input_json_delta' } }
      }
    ])
    expect(events.filter((e) => e.type === 'text_delta')).toHaveLength(0)
  })

  it('pairs tool_use blocks with their tool_result blocks', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'git diff' } }]
        }
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', is_error: false }] }
      }
    ])
    expect(events).toContainEqual({
      type: 'tool_start',
      toolCallId: 'tu-1',
      name: 'Bash',
      detail: 'git diff'
    })
    // The tool_result block doesn't repeat the name, so it is carried over
    // from the tool_use — a consumer can render a tool_end on its own.
    expect(events).toContainEqual({
      type: 'tool_end',
      toolCallId: 'tu-1',
      name: 'Bash',
      status: 'completed'
    })
  })

  it('marks a failed tool result as failed', async () => {
    const events = await collect([
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', is_error: true }] }
      }
    ])
    // No tool_use preceded this one, so there is no name to carry over. Empty
    // rather than invented — a malformed stream shouldn't produce a plausible
    // tool name the UI would then display as fact.
    expect(events).toContainEqual({
      type: 'tool_end',
      toolCallId: 'tu-1',
      name: '',
      status: 'failed'
    })
  })

  it('survives a user message whose content is a bare string', async () => {
    const events = await collect([{ type: 'user', message: { content: 'plain text' } }])
    expect(events.filter((e) => e.type === 'tool_end')).toHaveLength(0)
  })

  it('converts tool_progress seconds into milliseconds', async () => {
    const events = await collect([
      {
        type: 'tool_progress',
        tool_use_id: 'tu-1',
        tool_name: 'Bash',
        elapsed_time_seconds: 2.5
      }
    ])
    expect(events).toContainEqual({
      type: 'tool_progress',
      toolCallId: 'tu-1',
      name: 'Bash',
      elapsedMs: 2500
    })
  })

  it('turns permission denials into a sandbox_denied error', async () => {
    // This is how a read_only refusal reaches the UI: the SDK reports it on
    // the result rather than as a failure.
    const events = await collect([
      {
        type: 'result',
        subtype: 'success',
        result: 'refused',
        modelUsage: modelUsage(),
        permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: {} }]
      }
    ])
    expect(events).toContainEqual({
      type: 'error',
      kind: 'sandbox_denied',
      message: "Blocked Bash: this persona's sandbox does not allow it."
    })
  })

  it('reports an error result that carried no denial', async () => {
    const events = await collect([
      {
        type: 'result',
        subtype: 'error_during_execution',
        modelUsage: modelUsage(),
        errors: ['boom']
      }
    ])
    expect(events).toContainEqual({ type: 'error', kind: 'unknown', message: 'boom' })
  })

  it('classifies an assistant-level error code', async () => {
    const events = await collect([
      { type: 'assistant', error: 'rate_limit', message: { content: [] } }
    ])
    expect(events.find((e) => e.type === 'error')).toMatchObject({ kind: 'rate_limit' })
  })

  it('ends with done carrying the final text and usage', async () => {
    const events = await collect([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
      { type: 'result', subtype: 'success', result: 'final answer', modelUsage: modelUsage() }
    ])
    const last = events.at(-1)
    expect(last).toMatchObject({ type: 'done', finalText: 'final answer' })
    expect((last as { usage: { outputTokens: number } }).usage.outputTokens).toBe(1045)
  })

  it('ignores message types it does not model', async () => {
    // The SDKMessage union has well over thirty variants and grows every
    // release; an unmodelled one must not become an error or a crash.
    const events = await collect([
      { type: 'rate_limit_event', foo: 1 },
      { type: 'some_future_thing' },
      { type: 'result', subtype: 'success', result: 'ok', modelUsage: modelUsage() }
    ])
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ type: 'done', finalText: 'ok' })
  })

  it('reports a thrown failure as an error event and still finishes', async () => {
    query.mockReturnValue({
      // eslint-disable-next-line require-yield -- the point is that it throws
      async *[Symbol.asyncIterator]() {
        throw new Error('ECONNRESET while streaming')
      }
    })
    const adapter = createClaudeAdapter()
    const events: AgentEvent[] = []
    for await (const event of adapter.run(adapter.createSession(SPEC), 'go')) events.push(event)

    expect(events[0]).toMatchObject({ type: 'error', kind: 'network' })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })
})

describe('sandbox wiring', () => {
  it('denies a write tool through canUseTool at read_only', async () => {
    await collect([])
    const { canUseTool } = query.mock.calls[0][0].options
    const result = await canUseTool('Write', { file_path: '/tmp/repo/a.ts' }, {})
    expect(result.behavior).toBe('deny')
  })

  it('allows an inspection command at read_only', async () => {
    await collect([])
    const { canUseTool } = query.mock.calls[0][0].options
    const result = await canUseTool('Bash', { command: 'git diff' }, {})
    expect(result.behavior).toBe('allow')
  })

  it('strips the write tools from the model context too', async () => {
    await collect([])
    expect(query.mock.calls[0][0].options.disallowedTools).toContain('Write')
  })

  it('never inherits the working repo settings into a persona', async () => {
    await collect([])
    expect(query.mock.calls[0][0].options.settingSources).toEqual([])
  })

  it('spreads process.env rather than replacing it', async () => {
    // `env` REPLACES the subprocess environment in this SDK; dropping PATH
    // and HOME breaks the CLI outright.
    await collect([])
    expect(query.mock.calls[0][0].options.env.PATH).toBe(process.env.PATH)
  })
})

describe('summarize', () => {
  /**
   * Captured from a real run: `npm run probe:structured -- --backend claude
   * --raw`, haiku-4.5, 2026-08-16. Field-for-field as the SDK sent it.
   */
  const SCHEMA = { type: 'object', properties: { summary: { type: 'string' } } }

  const SUMMARY = {
    summary:
      'Optimized the auth module to cache token reads at the module level with mtime-based invalidation in src/auth.ts, chosen over simpler timer-based caching to avoid serving revoked tokens during the cache interval.',
    category: 'tradeoff'
  }

  function summaryResult(overrides: Record<string, unknown> = {}): unknown {
    return {
      type: 'result',
      subtype: 'success',
      // Note what this actually is: the JSON **as a string**, not the
      // placeholder an earlier reading of sdk.d.ts:1860-1866 predicted. The
      // placeholder in that note is the tool_result carrier inside the
      // transcript ("Structured output provided successfully"), which matters
      // for forking a session, not for reading its answer.
      result: JSON.stringify(SUMMARY),
      structured_output: SUMMARY,
      total_cost_usd: 0.016992999999999998,
      modelUsage: modelUsage(),
      permission_denials: [],
      stop_reason: 'tool_use',
      terminal_reason: 'completed',
      num_turns: 2,
      ...overrides
    }
  }

  async function run(messages: unknown[]): Promise<{ data: unknown; usage: unknown }> {
    mockStream(messages)
    const adapter = createClaudeAdapter()
    return adapter.summarize(adapter.createSession(SPEC), 'summarise this', SCHEMA)
  }

  it('reads the parsed structured_output, not the JSON string in result', async () => {
    // Both carry the answer, but `result` is a string: run() maps it to
    // done.finalText, so a caller reusing that path would persist raw JSON into
    // the Group as a summary rather than a sentence.
    const { data } = await run([summaryResult()])
    expect(data).toEqual(SUMMARY)
    expect(typeof data).toBe('object')
  })

  it('passes the schema as a session-level outputFormat', async () => {
    await run([summaryResult()])
    expect(query.mock.calls[0][0].options.outputFormat).toEqual({
      type: 'json_schema',
      schema: SCHEMA
    })
  })

  it('reports usage so a summary turn is billable like any other', async () => {
    const { usage } = await run([summaryResult()])
    expect(usage).toMatchObject({ costUsd: 0.016992999999999998, costSource: 'sdk' })
  })

  it('returns null when the SDK exhausted its structured-output retries', async () => {
    // error_max_structured_output_retries means the SDK already retried and
    // gave up. A missing Group entry is the right degradation — the user's
    // turn was committed long before this ran.
    const { data } = await run([
      summaryResult({
        subtype: 'error_max_structured_output_retries',
        structured_output: undefined
      })
    ])
    expect(data).toBeNull()
  })

  it('returns null rather than throwing when the query itself fails', async () => {
    query.mockImplementation(() => {
      throw new Error('spawn failed')
    })
    const adapter = createClaudeAdapter()
    await expect(
      adapter.summarize(adapter.createSession(SPEC), 'summarise', SCHEMA)
    ).resolves.toEqual({ data: null, usage: null })
  })

  it('gives the summariser no tools to reach the repo with', async () => {
    await run([summaryResult()])
    const { disallowedTools } = query.mock.calls[0][0].options
    expect(disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit']))
  })
})
