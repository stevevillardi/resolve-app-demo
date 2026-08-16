import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk'
import type { AgentEvent } from '../../shared/agent'
import type { PersonaTemplate } from '../../shared/domain'
import type { SessionSpec } from './types'
import { SUMMARY_JSON_SCHEMA, summarySchema } from '../../shared/summary'

/**
 * Event shapes here are the ones observed on real `codex exec
 * --experimental-json` runs (see docs/plan/05-backend-adapters.md), so the
 * normalization is pinned to what the CLI actually emits rather than to what
 * the .d.ts permits.
 */

let events: ThreadEvent[] = []
let lastClientOptions: Record<string, unknown> | undefined
let lastThreadOptions: Record<string, unknown> | undefined
let lastResumedId: string | undefined

/** Set by the summarize tests; `run()` is the non-streaming turn they use. */
let turnResult: { finalResponse: string; usage: unknown; items: unknown[] } = {
  finalResponse: '',
  usage: null,
  items: []
}
let lastTurnOptions: Record<string, unknown> | undefined

class FakeThread {
  async runStreamed(): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    return {
      events: (async function* () {
        for (const event of events) yield event
      })()
    }
  }
  async run(_prompt: string, options: Record<string, unknown>): Promise<typeof turnResult> {
    lastTurnOptions = options
    return turnResult
  }
}

class FakeCodex {
  constructor(options: Record<string, unknown>) {
    lastClientOptions = options
  }
  startThread(options: Record<string, unknown>): FakeThread {
    lastThreadOptions = options
    return new FakeThread()
  }
  resumeThread(id: string, options: Record<string, unknown>): FakeThread {
    lastResumedId = id
    lastThreadOptions = options
    return new FakeThread()
  }
}

vi.mock('@openai/codex-sdk', () => ({ Codex: FakeCodex }))

const { DEFAULT_CODEX_MODEL, createCodexAdapter, toolDetailFor, toolNameFor, usageFromTurn } =
  await import('./codex')

const PERSONA: PersonaTemplate = {
  id: 'p1',
  name: 'Reviewer',
  avatarColor: '#000',
  backend: 'codex',
  model: null,
  systemPrompt: 'You review code.',
  skillIds: [],
  sandbox: 'read_only',
  githubScope: 'read_only'
}

const SPEC: SessionSpec = { persona: PERSONA, repoPath: '/tmp/repo', skills: [] }

async function collect(
  stream: ThreadEvent[],
  sessionId: string | null = null
): Promise<AgentEvent[]> {
  events = stream
  const adapter = createCodexAdapter()
  const session = sessionId ? adapter.resume(SPEC, sessionId) : adapter.createSession(SPEC)
  const collected: AgentEvent[] = []
  for await (const event of adapter.run(session, 'go')) collected.push(event)
  return collected
}

function command(overrides: Partial<ThreadItem> = {}): ThreadItem {
  return {
    id: 'item-1',
    type: 'command_execution',
    command: "/bin/zsh -lc 'git diff -- .'",
    aggregated_output: '',
    status: 'in_progress',
    ...overrides
  } as ThreadItem
}

beforeEach(() => {
  events = []
  lastClientOptions = undefined
  lastThreadOptions = undefined
  lastResumedId = undefined
})

describe('toolNameFor', () => {
  it('maps Codex item types onto the same vocabulary the Claude adapter emits', () => {
    expect(toolNameFor(command())).toBe('Bash')
    expect(toolNameFor({ id: 'i', type: 'file_change', changes: [], status: 'completed' })).toBe(
      'Edit'
    )
    expect(toolNameFor({ id: 'i', type: 'web_search', query: 'x' })).toBe('WebSearch')
    expect(toolNameFor({ id: 'i', type: 'todo_list', items: [] })).toBe('TodoWrite')
  })

  it('qualifies an MCP tool by its server', () => {
    expect(
      toolNameFor({
        id: 'i',
        type: 'mcp_tool_call',
        server: 'fs',
        tool: 'read',
        arguments: {},
        status: 'completed'
      })
    ).toBe('fs__read')
  })
})

describe('toolDetailFor', () => {
  it('describes what each kind of call is doing', () => {
    expect(toolDetailFor(command())).toBe("/bin/zsh -lc 'git diff -- .'")
    expect(
      toolDetailFor({
        id: 'i',
        type: 'file_change',
        changes: [
          { path: 'a.ts', kind: 'update' },
          { path: 'b.ts', kind: 'add' }
        ],
        status: 'completed'
      })
    ).toBe('update a.ts, add b.ts')
    expect(toolDetailFor({ id: 'i', type: 'web_search', query: 'zod' })).toBe('zod')
  })

  it('is empty for items with nothing useful to show', () => {
    expect(toolDetailFor({ id: 'i', type: 'reasoning', text: 'thinking' })).toBe('')
  })
})

describe('usageFromTurn', () => {
  it('maps the Codex field names onto ours and computes a cost', () => {
    const usage = usageFromTurn(
      {
        input_tokens: 24696,
        cached_input_tokens: 21248,
        cache_write_input_tokens: 0,
        output_tokens: 242,
        reasoning_output_tokens: 53
      },
      'gpt-5.5'
    )
    expect(usage).toMatchObject({
      inputTokens: 24696,
      outputTokens: 242,
      cachedInputTokens: 21248,
      reasoningOutputTokens: 53,
      costSource: 'computed',
      model: 'gpt-5.5'
    })
    expect(usage?.costUsd).toBeCloseTo(0.035124, 9)
  })

  it('reports a null cost for a model with no published price', () => {
    const usage = usageFromTurn(
      {
        input_tokens: 1,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0
      },
      'gpt-unpriced'
    )
    expect(usage?.costUsd).toBeNull()
  })

  it('returns null when the turn reported no usage at all', () => {
    expect(usageFromTurn(null, 'gpt-5.5')).toBeNull()
    expect(usageFromTurn(undefined, 'gpt-5.5')).toBeNull()
  })
})

describe('session wiring', () => {
  it('passes the persona instructions as developer_instructions', async () => {
    // Blueprint §14 open item #1: this is the only injection route the SDK
    // offers, and it lives on the client rather than the thread.
    await collect([])
    expect((lastClientOptions?.config as Record<string, string>).developer_instructions).toBe(
      'You review code.'
    )
  })

  it('builds a client per session, so personas cannot share instructions', async () => {
    await collect([])
    const first = lastClientOptions
    events = []
    const adapter = createCodexAdapter()
    const other: SessionSpec = {
      ...SPEC,
      persona: { ...PERSONA, systemPrompt: 'You write tests.' }
    }
    for await (const _ of adapter.run(adapter.createSession(other), 'go')) void _
    expect(lastClientOptions).not.toBe(first)
    expect((lastClientOptions?.config as Record<string, string>).developer_instructions).toBe(
      'You write tests.'
    )
  })

  it('translates the sandbox level to Codex hyphenated names', async () => {
    await collect([])
    expect(lastThreadOptions?.sandboxMode).toBe('read-only')
  })

  it('always names a model, so the cost is attributable', async () => {
    await collect([])
    expect(lastThreadOptions?.model).toBe(DEFAULT_CODEX_MODEL)
  })

  it('honours a per-session model override', async () => {
    events = []
    const adapter = createCodexAdapter()
    const spec: SessionSpec = { ...SPEC, model: 'gpt-5.4' }
    for await (const _ of adapter.run(adapter.createSession(spec), 'go')) void _
    expect(lastThreadOptions?.model).toBe('gpt-5.4')
  })

  it('resumes by thread id', async () => {
    await collect([], 'thread-9')
    expect(lastResumedId).toBe('thread-9')
  })

  it('injects the binary path only when the host supplies one', async () => {
    events = []
    const adapter = createCodexAdapter({ codexBinaryPath: '/opt/codex' })
    for await (const _ of adapter.run(adapter.createSession(SPEC), 'go')) void _
    expect(lastClientOptions?.codexPathOverride).toBe('/opt/codex')

    events = []
    const bare = createCodexAdapter()
    for await (const _ of bare.run(bare.createSession(SPEC), 'go')) void _
    expect(lastClientOptions).not.toHaveProperty('codexPathOverride')
  })
})

describe('stream normalization', () => {
  it('captures the thread id as the session id', async () => {
    const collected = await collect([{ type: 'thread.started', thread_id: 'th-1' }])
    expect(collected[0]).toEqual({ type: 'session_started', sessionId: 'th-1' })
  })

  it('writes the thread id back onto the session', async () => {
    events = [{ type: 'thread.started', thread_id: 'th-2' }]
    const adapter = createCodexAdapter()
    const session = adapter.createSession(SPEC)
    for await (const _ of adapter.run(session, 'go')) void _
    expect(session.sessionId).toBe('th-2')
  })

  it('emits whole messages, never deltas', async () => {
    const collected = await collect([
      { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'all of it' } }
    ])
    expect(collected).toContainEqual({ type: 'text_message', text: 'all of it' })
    expect(collected.filter((e) => e.type === 'text_delta')).toHaveLength(0)
  })

  it('surfaces reasoning separately from the answer', async () => {
    const collected = await collect([
      { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'hmm' } }
    ])
    expect(collected).toContainEqual({ type: 'reasoning', text: 'hmm' })
  })

  it('pairs a started command with its completion', async () => {
    const collected = await collect([
      { type: 'item.started', item: command() },
      { type: 'item.completed', item: command({ status: 'completed', exit_code: 0 }) }
    ])
    expect(collected).toContainEqual({
      type: 'tool_start',
      toolCallId: 'item-1',
      name: 'Bash',
      detail: "/bin/zsh -lc 'git diff -- .'"
    })
    expect(collected).toContainEqual({
      type: 'tool_end',
      toolCallId: 'item-1',
      name: 'Bash',
      status: 'completed',
      detail: "/bin/zsh -lc 'git diff -- .'"
    })
  })

  it('reports live command output as progress', async () => {
    const collected = await collect([
      { type: 'item.started', item: command() },
      { type: 'item.updated', item: command({ aggregated_output: 'half done' }) }
    ])
    expect(collected).toContainEqual({
      type: 'tool_progress',
      toolCallId: 'item-1',
      name: 'Bash',
      output: 'half done'
    })
  })

  it('marks a failed command as failed', async () => {
    const collected = await collect([
      { type: 'item.completed', item: command({ status: 'failed', exit_code: 1 }) }
    ])
    expect(collected.find((e) => e.type === 'tool_end')).toMatchObject({ status: 'failed' })
  })

  it('synthesizes a start for items that only ever arrive completed', async () => {
    // file_change and web_search have no started event, but the UI still
    // needs a start to pair the end against.
    const collected = await collect([
      {
        type: 'item.completed',
        item: {
          id: 'fc',
          type: 'file_change',
          changes: [{ path: 'a.ts', kind: 'update' }],
          status: 'completed'
        }
      }
    ])
    expect(collected.filter((e) => e.type === 'tool_start')).toHaveLength(1)
    expect(collected.filter((e) => e.type === 'tool_end')).toHaveLength(1)
  })

  it('does not double up the start when one was already emitted', async () => {
    const collected = await collect([
      { type: 'item.started', item: command() },
      { type: 'item.completed', item: command({ status: 'completed' }) }
    ])
    expect(collected.filter((e) => e.type === 'tool_start')).toHaveLength(1)
  })

  it('turns a non-fatal error item into an error event', async () => {
    const collected = await collect([
      { type: 'item.completed', item: { id: 'e', type: 'error', message: 'rate limit hit' } }
    ])
    expect(collected).toContainEqual({
      type: 'error',
      kind: 'rate_limit',
      message: 'rate limit hit'
    })
  })

  it('classifies a failed turn', async () => {
    const collected = await collect([
      { type: 'turn.failed', error: { message: 'the workspace is read-only' } }
    ])
    expect(collected).toContainEqual({
      type: 'error',
      kind: 'sandbox_denied',
      message: 'the workspace is read-only'
    })
  })

  it('classifies a fatal stream error', async () => {
    const collected = await collect([{ type: 'error', message: 'HTTP 401: unauthorized' }])
    expect(collected).toContainEqual({
      type: 'error',
      kind: 'auth',
      message: 'HTTP 401: unauthorized'
    })
  })

  it('ends with done carrying the final text and usage', async () => {
    const collected = await collect([
      { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'answer' } },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 0
        }
      }
    ])
    expect(collected.at(-1)).toMatchObject({ type: 'done', finalText: 'answer' })
  })

  it('still finishes with done when the subprocess never streamed', async () => {
    // An expired login rejects runStreamed() outright rather than emitting
    // turn.failed — blueprint §15C still wants that visible in the thread.
    const adapter = createCodexAdapter()
    const failing = adapter.createSession(SPEC)
    vi.spyOn(FakeThread.prototype, 'runStreamed').mockRejectedValueOnce(
      new Error('Please log out and sign in again.')
    )
    const collected: AgentEvent[] = []
    for await (const event of adapter.run(failing, 'go')) collected.push(event)

    expect(collected[0]).toMatchObject({ type: 'error', kind: 'auth' })
    expect(collected.at(-1)).toMatchObject({ type: 'done', usage: null })
  })

  it('ignores event types it does not model', async () => {
    const collected = await collect([
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 't', type: 'todo_list', items: [] } }
    ])
    expect(collected.filter((e) => e.type === 'error')).toHaveLength(0)
  })
})

describe('summarize', () => {
  /**
   * Shapes captured from a real run: `npm run probe:structured -- --backend
   * codex --raw`, gpt-5.4-mini, 2026-08-16.
   */
  const SCHEMA = { type: 'object', properties: { summary: { type: 'string' } } }

  async function run(finalResponse: string, usage: unknown = null): Promise<unknown> {
    turnResult = { finalResponse, usage, items: [] }
    const adapter = createCodexAdapter()
    const result = await adapter.summarize(adapter.createSession(SPEC), 'summarise', SCHEMA)
    return result.data
  }

  beforeEach(() => {
    turnResult = { finalResponse: '', usage: null, items: [] }
    lastTurnOptions = undefined
  })

  it('parses the JSON out of finalResponse', async () => {
    // Unlike Claude there is no separate field — the SDK documents this text
    // as "either natural-language text or JSON when structured output is
    // requested", so the answer arrives exactly where prose would.
    expect(await run('{"summary":"Renamed foo to bar.","category":"decision"}')).toEqual({
      summary: 'Renamed foo to bar.',
      category: 'decision'
    })
  })

  it('passes the schema as a per-turn outputSchema', async () => {
    await run('{}')
    expect(lastTurnOptions?.outputSchema).toEqual(SCHEMA)
  })

  it('tolerates a fenced code block', async () => {
    // Asked for JSON in prose form, a model frequently fences it. Discarding
    // an otherwise-valid summary over three backticks would be a poor trade.
    expect(await run('```json\n{"summary":"ok","category":"routine"}\n```')).toEqual({
      summary: 'ok',
      category: 'routine'
    })
  })

  it('returns null when the model answered with prose instead', async () => {
    // Indistinguishable, by design, from Claude exhausting its retries: both
    // mean "no conforming answer this turn".
    expect(await run('I renamed foo to bar because the old name was ambiguous.')).toBeNull()
  })

  it('reports usage so a summary turn is billable like any other', async () => {
    turnResult = {
      finalResponse: '{"summary":"ok","category":"routine"}',
      usage: { input_tokens: 900, cached_input_tokens: 100, output_tokens: 40 },
      items: []
    }
    const adapter = createCodexAdapter()
    const { usage } = await adapter.summarize(adapter.createSession(SPEC), 'go', SCHEMA)
    expect(usage).toMatchObject({ outputTokens: 40, costSource: 'computed' })
  })

  it('runs read-only regardless of what the persona could do', async () => {
    // Deliberately a workspace_write persona: with the read_only default this
    // assertion would hold even if summarize() passed the persona's own level
    // through, which is the thing being ruled out.
    turnResult = { finalResponse: '{}', usage: null, items: [] }
    const adapter = createCodexAdapter()
    const spec: SessionSpec = { ...SPEC, persona: { ...PERSONA, sandbox: 'workspace_write' } }
    await adapter.summarize(adapter.createSession(spec), 'go', SCHEMA)
    expect(lastThreadOptions?.sandboxMode).toBe('read-only')
  })
})

describe('the summary schema Codex is actually sent', () => {
  /**
   * Codex hands `outputSchema` to OpenAI's **strict** structured-output mode,
   * which is stricter than JSON Schema: every key in `properties` must appear
   * in `required`, and optionality has to be expressed as a nullable type.
   *
   * A schema with an optional `branch` is rejected outright:
   *
   *   400 invalid_json_schema — 'required' is required to be supplied and to
   *   be an array including every key in properties. Missing 'branch'.
   *
   * Neither SDK's typings say any of this — both take `Record<string, unknown>`
   * — so nothing but a live run could have found it, and nothing but a test
   * will stop the next person "tidying" branch back to optional.
   */
  it('lists every property as required', () => {
    const properties = Object.keys(SUMMARY_JSON_SCHEMA.properties as Record<string, unknown>)
    expect(SUMMARY_JSON_SCHEMA.required).toEqual(properties)
  })

  it('expresses an absent branch as a nullable type rather than an omission', () => {
    const properties = SUMMARY_JSON_SCHEMA.properties as Record<string, { type: unknown }>
    expect(properties.branch.type).toEqual(['string', 'null'])
  })

  it('forbids additional properties, as strict mode requires', () => {
    expect(SUMMARY_JSON_SCHEMA.additionalProperties).toBe(false)
  })

  it('accepts the null branch both backends send when there is none', () => {
    // Claude omits the key, Codex sends null. Both mean the same thing, and
    // compaction stores neither.
    expect(
      summarySchema.safeParse({ summary: 'x', category: 'routine', branch: null }).success
    ).toBe(true)
    expect(summarySchema.safeParse({ summary: 'x', category: 'routine' }).success).toBe(true)
  })
})
