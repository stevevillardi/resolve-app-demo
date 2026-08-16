import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk'
import type { AgentCapabilities, AgentEvent, AgentUsage } from '../../shared/agent'
import { composeInstructions } from './context'
import { classifyErrorMessage } from './errors'
import { computeCodexCost } from './pricing'
import { codexSandboxMode } from './sandbox'
import type { AdapterConfig, AgentAdapter, AgentSession, SessionSpec } from './types'

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
  sandboxEnforcement: 'os'
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

export function usageFromTurn(usage: Usage | null | undefined, model: string): AgentUsage | null {
  if (!usage) return null
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    costUsd: computeCodexCost(model, usage),
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
          usage = usageFromTurn(event.usage, model)
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

  return {
    backend: 'codex',
    capabilities: CODEX_CAPABILITIES,
    createSession: (spec) => session(spec, null),
    resume: (spec, sessionId) => session(spec, sessionId),
    run
  }
}
