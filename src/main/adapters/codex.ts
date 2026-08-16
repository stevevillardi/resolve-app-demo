import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk'
import type { AgentCapabilities, AgentEvent, AgentUsage } from '../../shared/agent'
import { composeInstructions } from './context'
import { classifyErrorMessage } from './errors'
import { computeCodexCost } from './pricing'
import { codexSandboxMode } from './sandbox'
import type {
  AdapterConfig,
  AgentAdapter,
  AgentSession,
  SessionSpec,
  StructuredResult
} from './types'

/**
 * The Codex backend, on @openai/codex-sdk.
 *
 * Two things about this SDK shape the adapter:
 *
 * 1. `config` lives on the Codex *client*, not on ThreadOptions, and
 *    `developer_instructions` is the only route for per-persona context
 *    (blueprint §5). So a client is constructed per session rather than
 *    shared — a single app-wide Codex would force every persona to share one
 *    set of instructions.
 * 2. Every run spawns a fresh `codex exec --experimental-json` subprocess and
 *    resumes by thread id (threads live in ~/.codex/sessions). There is no
 *    long-lived process, which is why AgentSession holds no handle.
 *
 * The package is imported dynamically, not statically. Its exports map
 * declares only an `import` condition — no `require`, no `default` — so a
 * `require()` of it fails outright with ERR_PACKAGE_PATH_NOT_EXPORTED, and
 * electron-vite builds the main process as CommonJS with externalized
 * dependencies. Phase 3 never hit this because codex-auth.ts imports only
 * types, which erase at compile time; this adapter is the first code to need
 * the package at runtime. `await import()` is the one form that resolves an
 * ESM-only package from CJS.
 */

export const CODEX_CAPABILITIES: AgentCapabilities = {
  // Items arrive whole — there is no token-level delta in the JSONL protocol.
  streamsTextDeltas: false,
  // The inverse of Claude's shape: live CommandExecutionStatus while a command
  // runs, which is exactly the visibility blueprint §3 credits Codex with.
  streamsToolProgress: true,
  costSource: 'computed',
  // The CLI's own `--sandbox` preset is enforced by the OS, on every platform
  // it runs on. This was already true in Phase 5 — it is only stated now that
  // the Claude side has an equivalent to be compared against.
  sandboxEnforcement: 'os',
  // TurnOptions.outputSchema in 0.147.0. Per-turn rather than per-session,
  // unlike Claude — see summarize().
  supportsStructuredOutput: true
}

/**
 * Codex's item types mapped onto the same tool vocabulary the Claude adapter
 * emits, so the UI renders one set of names rather than branching on backend.
 */
export function toolNameFor(item: ThreadItem): string {
  switch (item.type) {
    case 'command_execution':
      return 'Bash'
    case 'file_change':
      return 'Edit'
    case 'web_search':
      return 'WebSearch'
    case 'mcp_tool_call':
      return `${item.server}__${item.tool}`
    case 'todo_list':
      return 'TodoWrite'
    default:
      return item.type
  }
}

export function toolDetailFor(item: ThreadItem): string {
  switch (item.type) {
    case 'command_execution':
      return item.command
    case 'file_change':
      return item.changes.map((change) => `${change.kind} ${change.path}`).join(', ')
    case 'web_search':
      return item.query
    default:
      return ''
  }
}

/** Item types that represent work worth showing as a tool call. */
function isToolItem(item: ThreadItem): boolean {
  return (
    item.type === 'command_execution' ||
    item.type === 'file_change' ||
    item.type === 'web_search' ||
    item.type === 'mcp_tool_call'
  )
}

/**
 * Codex's `turn.completed` reading minus what the thread has already been
 * billed for.
 *
 * The SDK types every field as usage "during the turn" (`dist/index.d.ts:119`)
 * and that is simply not what it sends — three one-word replies on one resumed
 * thread reported 5, 10 and 15 output tokens. See baselineFor() in
 * services/usage-events.ts for the full measurement.
 *
 * Floored at 0 rather than trusted: the first turn after this shipped sees a
 * baseline summed only from rows that carry a session id, so on a thread that
 * predates the column the reading can legitimately exceed it. A negative token
 * count would be a worse lie than a low one.
 */
export function deltaFrom(usage: Usage, baseline: AgentUsage | null | undefined): Usage {
  if (!baseline) return usage
  const less = (reported: number, billed: number | undefined): number =>
    Math.max(0, reported - (billed ?? 0))

  return {
    input_tokens: less(usage.input_tokens, baseline.inputTokens),
    cached_input_tokens: less(usage.cached_input_tokens, baseline.cachedInputTokens),
    cache_write_input_tokens: less(usage.cache_write_input_tokens, baseline.cacheWriteInputTokens),
    output_tokens: less(usage.output_tokens, baseline.outputTokens),
    reasoning_output_tokens: less(usage.reasoning_output_tokens, baseline.reasoningOutputTokens)
  }
}

export function usageFromTurn(
  usage: Usage | null | undefined,
  model: string,
  baseline?: AgentUsage | null
): AgentUsage | null {
  if (!usage) return null

  // Subtracted before pricing, never after: cost is recomputed from this turn's
  // own tokens rather than differenced out of two cumulative totals.
  const turn = deltaFrom(usage, baseline)

  return {
    inputTokens: turn.input_tokens,
    outputTokens: turn.output_tokens,
    cachedInputTokens: turn.cached_input_tokens,
    cacheWriteInputTokens: turn.cache_write_input_tokens,
    reasoningOutputTokens: turn.reasoning_output_tokens,
    costUsd: computeCodexCost(model, turn),
    costSource: 'computed',
    model
  }
}

// --- Adapter ----------------------------------------------------------------

/**
 * Passed explicitly rather than left to the CLI's own default, so the model a
 * UsageEvent is priced against is provably the model that ran — the SDK's
 * event stream never names it, and `~/.codex/config.toml` can silently pick a
 * different one per machine.
 *
 * Two things make this constant load-bearing, both found by probing rather
 * than reading docs. Model availability depends on the *auth type*: a ChatGPT
 * account rejects `gpt-5.2-codex` and `gpt-5.3-codex` with a 400 even though
 * codex-cli 0.147.0 knows both names. And an unpriced model reports a null
 * cost, so this must stay in step with CODEX_PRICES in pricing.ts.
 */
export const DEFAULT_CODEX_MODEL = 'gpt-5.5'

export function createCodexAdapter(config: AdapterConfig = {}): AgentAdapter {
  function session(spec: SessionSpec, sessionId: string | null): AgentSession {
    return { backend: 'codex', spec, sessionId }
  }

  async function* run(
    agentSession: AgentSession,
    prompt: string,
    signal?: AbortSignal
  ): AsyncIterable<AgentEvent> {
    const { spec } = agentSession
    const model = spec.model ?? DEFAULT_CODEX_MODEL

    const { Codex } = await import('@openai/codex-sdk')

    const client = new Codex({
      // Injected rather than resolved here: inside a packaged app the vendored
      // binary lives under app.asar.unpacked, which the SDK's own
      // require.resolve lookup cannot see. See resolveCodexBinary() in
      // src/main/services/codex-auth.ts.
      ...(config.codexBinaryPath ? { codexPathOverride: config.codexBinaryPath } : {}),
      ...(config.env ? { env: { ...process.env, ...config.env } as Record<string, string> } : {}),
      config: { developer_instructions: composeInstructions(spec) }
    })

    const threadOptions = {
      model,
      sandboxMode: codexSandboxMode(spec.persona.sandbox),
      workingDirectory: spec.repoPath
    }

    const thread = agentSession.sessionId
      ? client.resumeThread(agentSession.sessionId, threadOptions)
      : client.startThread(threadOptions)

    const started = new Set<string>()
    let finalText = ''
    let usage: AgentUsage | null = null

    // The subprocess can fail outside the event stream entirely — a bad
    // binary path, or an expired login, which surfaces as a rejection from
    // runStreamed() rather than a turn.failed event. Blueprint §15C wants
    // every failure to reach the thread as a visible error, so nothing here
    // is allowed to escape as a bare exception.
    try {
      const { events } = await thread.runStreamed(prompt, signal ? { signal } : {})

      for await (const event of events as AsyncGenerator<ThreadEvent>) {
        config.onRawEvent?.(event)

        yield* normalize(event)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { type: 'error', kind: classifyErrorMessage(message), message }
    }

    yield { type: 'done', finalText, usage }

    // Declared as a generator over one event so the switch below can stay a
    // statement-per-case mapping rather than building arrays.
    function* normalize(event: ThreadEvent): Generator<AgentEvent> {
      switch (event.type) {
        case 'thread.started': {
          agentSession.sessionId = event.thread_id
          yield { type: 'session_started', sessionId: event.thread_id }
          break
        }

        case 'item.started': {
          if (!isToolItem(event.item)) break
          started.add(event.item.id)
          yield {
            type: 'tool_start',
            toolCallId: event.item.id,
            name: toolNameFor(event.item),
            detail: toolDetailFor(event.item)
          }
          break
        }

        case 'item.updated': {
          if (event.item.type !== 'command_execution') break
          yield {
            type: 'tool_progress',
            toolCallId: event.item.id,
            name: 'Bash',
            output: event.item.aggregated_output
          }
          break
        }

        case 'item.completed': {
          const { item } = event
          if (item.type === 'agent_message') {
            finalText = item.text
            yield { type: 'text_message', text: item.text }
          } else if (item.type === 'reasoning') {
            yield { type: 'reasoning', text: item.text }
          } else if (item.type === 'error') {
            yield { type: 'error', kind: classifyErrorMessage(item.message), message: item.message }
          } else if (isToolItem(item)) {
            // file_change and web_search only ever arrive completed, so
            // synthesize the start the UI is waiting to pair this with.
            if (!started.has(item.id)) {
              yield {
                type: 'tool_start',
                toolCallId: item.id,
                name: toolNameFor(item),
                detail: toolDetailFor(item)
              }
            }
            const failed =
              (item.type === 'command_execution' ||
                item.type === 'file_change' ||
                item.type === 'mcp_tool_call') &&
              item.status === 'failed'
            yield {
              type: 'tool_end',
              toolCallId: item.id,
              name: toolNameFor(item),
              status: failed ? 'failed' : 'completed',
              detail: toolDetailFor(item)
            }
          }
          break
        }

        case 'turn.completed': {
          usage = usageFromTurn(event.usage, model, spec.usageBaseline)
          break
        }

        case 'turn.failed': {
          yield {
            type: 'error',
            kind: classifyErrorMessage(event.error.message),
            message: event.error.message
          }
          break
        }

        case 'error': {
          yield { type: 'error', kind: classifyErrorMessage(event.message), message: event.message }
          break
        }

        default:
          break
      }
    }
  }

  /**
   * One schema-constrained turn (blueprint §6 compaction).
   *
   * The mirror image of the Claude side. `outputSchema` is a **per-turn**
   * TurnOptions field, so no separate session shape is needed — but there is
   * also no separate field to read the answer out of: the SDK documents
   * `AgentMessageItem.text` as "either natural-language text or JSON when
   * structured output is requested", so the JSON arrives exactly where prose
   * normally would and we parse it ourselves.
   *
   * A model that answers with prose anyway therefore surfaces as a parse
   * failure, which is the same null the Claude adapter returns when its retries
   * are exhausted. Callers cannot tell the two apart, and should not need to.
   *
   * `read-only` sandbox rather than the persona's: a summariser is given its
   * material in the prompt and has no reason to touch the tree.
   */
  async function summarize(
    agentSession: AgentSession,
    prompt: string,
    schema: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<StructuredResult> {
    const { spec } = agentSession
    const model = spec.model ?? DEFAULT_CODEX_MODEL

    try {
      const { Codex } = await import('@openai/codex-sdk')

      const client = new Codex({
        ...(config.codexBinaryPath ? { codexPathOverride: config.codexBinaryPath } : {}),
        ...(config.env ? { env: { ...process.env, ...config.env } as Record<string, string> } : {}),
        config: { developer_instructions: composeInstructions(spec) }
      })

      const thread = client.startThread({
        model,
        sandboxMode: 'read-only',
        workingDirectory: spec.repoPath
      })

      const turn = await thread.run(prompt, {
        outputSchema: schema,
        ...(signal ? { signal } : {})
      })

      config.onRawEvent?.(turn)

      return {
        data: parseJson(turn.finalResponse),
        // No baseline: startThread() every time, and a summariser thread is
        // never resumed, so its first turn is also its only one. The cumulative
        // reading and the per-turn one are the same number here.
        usage: turn.usage ? usageFromTurn(turn.usage, model) : null
      }
    } catch (error) {
      // Compaction never fails a turn that has already been persisted — but a
      // swallowed error with no channel out is undiagnosable, so it goes to the
      // raw hook that `probe:structured --raw` installs.
      config.onRawEvent?.({ type: 'summarize_error', error: String(error) })
      return { data: null, usage: null }
    }
  }

  return {
    backend: 'codex',
    capabilities: CODEX_CAPABILITIES,
    createSession: (spec) => session(spec, null),
    resume: (spec, sessionId) => session(spec, sessionId),
    run,
    summarize
  }
}

/**
 * Null rather than a throw on malformed JSON — see summarize().
 *
 * Tolerates a fenced ```json block, because a model asked for JSON in prose
 * form frequently supplies one and discarding an otherwise-valid summary over
 * three backticks would be a poor trade.
 */
function parseJson(text: string): unknown | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    return JSON.parse(unfenced)
  } catch {
    return null
  }
}
