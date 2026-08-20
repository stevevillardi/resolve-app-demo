import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import { TOOL_OUTPUT_MAX, toolExcerpt } from '../../shared/agent'
import type { AgentCapabilities, AgentErrorKind, AgentEvent, AgentUsage } from '../../shared/agent'
import { composeInstructionBlocks, composeInstructions } from './context'
import { classifyErrorMessage } from './errors'
import { GITHUB_MCP_ALL_TOOLS, qualifiedGithubToolName } from './github-mcp-tools'
import {
  claudeSandboxOptions,
  evaluateGithubShellUse,
  evaluateMcpToolUse,
  evaluateToolUse,
  osSandboxSupported
} from './sandbox'
import type {
  AdapterConfig,
  AgentAdapter,
  AgentSession,
  SessionSpec,
  StructuredResult
} from './types'

/**
 * The Claude backend, on @anthropic-ai/claude-agent-sdk.
 *
 * One query() per turn, resumed by session id, rather than one long-lived
 * streaming-input session. That choice is what keeps usage accounting simple:
 * the SDK documents `total_cost_usd` and `modelUsage` as *cumulative across
 * turns* within a streaming-input session, so a running session would need
 * every UsageEvent to be a delta against the previous result. Per-turn
 * queries make each result cover exactly one turn.
 */

/**
 * `streamsToolProgress` means "the protocol can carry it", which is what a UI
 * needs in order to decide whether to render a progress affordance at all.
 *
 * The SDK streams nothing during tool execution itself, only around it, so a
 * long tool call looks like silent thinking — which is why a running tool gets
 * its own loading state here rather than a fabricated progress figure. What the
 * protocol does carry is 0.3.233's SDKToolProgressMessage, with `tool_name` and
 * `elapsed_time_seconds`, and this adapter maps it. What has *not* been observed
 * is it actually firing: every probe run so far used fast tools (`git diff`,
 * `Read`), and none produced one, which is consistent with it being a heartbeat
 * for long-running calls. So the mapping is ready and the flag is honest about
 * capability, while the UI still assumes it may hear nothing at all.
 */
export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  streamsTextDeltas: true,
  streamsToolProgress: true,
  costSource: 'sdk',
  // Options.sandbox confines commands at the OS level wherever the SDK has an
  // implementation. Where it doesn't (Windows) we say so rather than implying
  // a boundary that is only our in-process allowlist.
  sandboxEnforcement: osSandboxSupported() ? 'os' : 'policy',
  // Options.outputFormat + SDKResultSuccess.structured_output, both present in
  // 0.3.233. See summarize() for the placeholder-carrier trap that comes with
  // them.
  supportsStructuredOutput: true
}

// --- Normalization helpers --------------------------------------------------

interface ContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

/**
 * How a tool call answered, as bounded text.
 *
 * A tool_result's `content` is either a plain string or an array of content
 * parts; only the text parts are worth keeping — an image result excerpted to
 * characters would be noise. Empty string means "nothing worth carrying", and
 * the caller omits the field rather than emitting an empty one.
 */
export function toolResultExcerpt(content: unknown): string {
  if (typeof content === 'string') return toolExcerpt(content, TOOL_OUTPUT_MAX)
  if (!Array.isArray(content)) return ''
  const text = content
    .map((part) =>
      part && typeof part === 'object' && (part as { type?: string }).type === 'text'
        ? ((part as { text?: string }).text ?? '')
        : ''
    )
    .filter(Boolean)
    .join('\n')
  return text ? toolExcerpt(text, TOOL_OUTPUT_MAX) : ''
}

/** A short human-readable summary of what a tool call is about to do. */
export function toolDetail(input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  const pick = (key: string): string | null =>
    typeof input[key] === 'string' ? (input[key] as string) : null
  return pick('command') ?? pick('file_path') ?? pick('notebook_path') ?? pick('pattern') ?? ''
}

/**
 * Maps the SDK's assistant-level error codes onto our kinds. The renderer
 * already distinguishes rate limits and network failures in its error bubble,
 * so the classification has to survive normalization.
 */
export function classifyClaudeError(code: string | undefined): AgentErrorKind {
  switch (code) {
    case 'rate_limit':
    case 'overloaded':
      return 'rate_limit'
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'billing_error':
      return 'auth'
    case 'server_error':
      return 'network'
    default:
      return 'unknown'
  }
}

/**
 * Rewords CLI error prose whose advice only works in a terminal.
 *
 * The unknown-model sentence ends "Run --model to pick a different model" —
 * there is no `--model` anywhere in this app; the model lives on the persona.
 * A raw vendor string whose advice cannot be acted on from here is never shown
 * as-is, and the error the CLI reports as a successful result is the one that
 * reaches a user most often (captured live 2026-08-18). Anything unrecognised
 * passes through untouched — a wrong rewording is worse than vendor wording.
 */
export function rewordCliErrorProse(text: string): string {
  const model = /issue with the selected model \(([^)]+)\)/i.exec(text)
  if (model) {
    return `The model '${model[1]}' isn't available on this account. Pick a different model in this persona's settings.`
  }
  return text
}

interface ResultLike {
  total_cost_usd?: number
  modelUsage?: Record<
    string,
    {
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
      cacheCreationInputTokens: number
      /** Optional so a payload without it degrades to the token tiebreak in
       *  usageFromResult() rather than failing to type-check. */
      costUSD?: number
    }
  >
  usage?: Record<string, unknown>
}

/**
 * Reads the turn's usage off a result message.
 *
 * Deliberately reads `modelUsage` rather than summing the per-step assistant
 * messages. Those can share one id across the steps of a single turn, so
 * anything summing them has to dedupe by id first or the turn is billed twice;
 * and the SDK's own type annotations say `usage` is main-loop-only while
 * `modelUsage` is "the correct field for token/cost accounting". Summing
 * assistant messages is the thing not to do at all, so there is nothing here to
 * dedupe.
 */
export function usageFromResult(result: ResultLike): AgentUsage | null {
  const entries = Object.entries(result.modelUsage ?? {})
  if (entries.length === 0) return null

  const totals = entries.reduce(
    (acc, [, usage]) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      cachedInputTokens: acc.cachedInputTokens + usage.cacheReadInputTokens,
      cacheWriteInputTokens: acc.cacheWriteInputTokens + usage.cacheCreationInputTokens
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 }
  )

  // A turn can touch several models (subagents, compaction, and — on the first
  // turn of any session — an SDK-internal haiku call). Name the one that spent
  // the most, because the figure this is attached to is a *cost*.
  //
  // Picking by output tokens instead, which this did until a live probe caught
  // it, gets the first turn of every session wrong. Measured on a fresh session
  // with the main loop on sonnet-5:
  //
  //   claude-haiku-4-5   521 in /  11 out /     0 cacheWrite   $0.000576
  //   claude-sonnet-5      2 in /   5 out / 27911 cacheWrite   $0.167547
  //
  // The internal call out-talks the real one, so the dashboard showed $0.168
  // against haiku. Cost is the honest tiebreak; output tokens is the fallback
  // for a payload that omits costUSD.
  const [model] = entries.reduce((best, entry) => {
    const spent = entry[1].costUSD ?? 0
    const bestSpent = best[1].costUSD ?? 0
    if (spent !== bestSpent) return spent > bestSpent ? entry : best
    return entry[1].outputTokens > best[1].outputTokens ? entry : best
  })

  return {
    ...totals,
    costUsd: result.total_cost_usd ?? null,
    costSource: 'sdk',
    model
  }
}

// --- Adapter ----------------------------------------------------------------

export function createClaudeAdapter(config: AdapterConfig = {}): AgentAdapter {
  function session(spec: SessionSpec, sessionId: string | null): AgentSession {
    return { backend: 'claude', spec, sessionId }
  }

  async function* run(
    agentSession: AgentSession,
    prompt: string,
    signal?: AbortSignal
  ): AsyncIterable<AgentEvent> {
    const { spec } = agentSession
    const sandbox = claudeSandboxOptions(
      spec.persona.sandbox,
      spec.repoPath,
      config.denyReadPaths ?? [],
      spec.writablePaths ?? []
    )
    const abort = signal ? abortControllerFor(signal) : null
    const servers = spec.mcpServers ?? []
    const { prefix, suffix } = composeInstructionBlocks(spec)

    const stream = query({
      prompt,
      options: {
        cwd: spec.repoPath,
        // Injected rather than left to the SDK's own require.resolve, which
        // resolves into app.asar in a packaged build and spawns ENOTDIR.
        ...(config.claudeBinaryPath ? { pathToClaudeCodeExecutable: config.claudeBinaryPath } : {}),
        // The boundary marks where the globally-cacheable half of the prompt
        // ends. Everything before it is stable for the life of the session;
        // the group summaries and sibling branches after it are re-resolved
        // every turn, and used to invalidate the whole prefix with them.
        systemPrompt: [...prefix, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, ...suffix],
        // A persona's instructions are the persona's alone — never whatever
        // CLAUDE.md or settings happen to sit in the repo it is working on.
        settingSources: [],
        includePartialMessages: true,
        permissionMode: sandbox.permissionMode,
        // Two axes, two lists, one concatenation. The sandbox names govern the
        // filesystem and the mcp__github__* names govern GitHub, and neither
        // was derived from the other — see githubMcpDenyList() in sandbox.ts.
        disallowedTools: [...sandbox.disallowedTools, ...servers.flatMap((s) => s.disallowedTools)],
        // The token travels in a header rather than the environment because
        // Claude offers the header. Absent entirely when the persona was
        // granted no server, which with strictMcpConfig below means no mcp__*
        // tool exists in the session at all.
        ...(servers.length > 0
          ? {
              mcpServers: Object.fromEntries(
                servers.map((server) => [
                  server.id,
                  {
                    type: 'http' as const,
                    url: server.url,
                    headers: { Authorization: `Bearer ${server.token}` }
                  }
                ])
              )
            }
          : {}),
        // Unconditional, and that is the point: it is what makes a repo's own
        // .mcp.json unreachable. Setting it only alongside a server would
        // relax the seal in exactly the case where nothing else is watching.
        strictMcpConfig: true,
        ...(sandbox.allowDangerouslySkipPermissions
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        // The layer that actually enforces the level; canUseTool below is the
        // second one. See the header of sandbox.ts for why it is this way round.
        ...(sandbox.sandbox ? { sandbox: sandbox.sandbox } : {}),
        // `env` REPLACES the subprocess environment rather than merging: nothing
        // is inherited unless process.env is spread explicitly, and a CLI spawned
        // without PATH and HOME does not start. claude-auth.ts spawns under the
        // same rule.
        env: { ...process.env, ...config.env } as Record<string, string>,
        canUseTool: async (toolName, input) => {
          // GitHub first, and separately: evaluateToolUse opens with
          // `if (level === 'full_access') return ALLOWED`, so folding the two
          // together would let the filesystem axis decide a GitHub question.
          // This returns ALLOWED for every name that is not this server's, so
          // Bash and Edit fall straight through to the check below.
          const mcp = evaluateMcpToolUse(spec.persona.githubScope, toolName)
          if (!mcp.allowed) {
            return { behavior: 'deny', message: mcp.reason ?? 'Denied by GitHub scope.' }
          }
          // ...and the same axis applied to the shell, because `gh`, `git push`
          // and `curl` all reach the same API without touching the server. A
          // live run found a read_only persona commenting through `gh` after
          // the MCP layer correctly refused it.
          const shell = evaluateGithubShellUse(spec.persona.githubScope, toolName, input)
          if (!shell.allowed) {
            return { behavior: 'deny', message: shell.reason ?? 'Denied by GitHub scope.' }
          }
          const decision = evaluateToolUse(spec.persona.sandbox, toolName, input, spec.repoPath)
          if (decision.allowed) return { behavior: 'allow', updatedInput: input }
          // The ask_writes hold: a would-be denial waits for a
          // human instead. The SDK is already awaiting this callback, so the
          // wait is just a promise — no handler means no one to ask, and the
          // only safe reading of silence is no.
          if (decision.ask) {
            const outcome = config.onApprovalRequest
              ? await config.onApprovalRequest({
                  toolName,
                  detail: toolDetail(input) || toolName
                })
              : {
                  approved: false,
                  reason: 'This persona asks before writing, and nothing here can ask.'
                }
            return outcome.approved
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: outcome.reason }
          }
          return { behavior: 'deny', message: decision.reason ?? 'Denied by sandbox policy.' }
        },
        ...(agentSession.sessionId ? { resume: agentSession.sessionId } : {}),
        ...(spec.model ? { model: spec.model } : {}),
        ...(abort ? { abortController: abort.controller } : {}),
        // The CLI's stderr is where a spawn failure explains itself, and where
        // the sandbox reports that it could not start. Discarding it threw away
        // the one channel that says why — route it to the raw hook instead.
        stderr: (data: string) => config.onRawEvent?.({ type: 'stderr', data })
      }
    })

    let finalText = ''
    let usage: AgentUsage | null = null
    let emittedError = false

    // tool_result blocks don't repeat the tool name, so remember it from the
    // matching tool_use. Without this every tool_end carried an empty name and
    // each consumer had to re-derive it by correlating ids.
    const toolNames = new Map<string, string>()

    // A failure can arrive as a thrown error rather than a result message —
    // a missing CLI, a dead network, an expired login. Every failure has to
    // reach the thread as a visible error bubble rather than a silent stop or a
    // line in a console, so none escapes as an exception.
    try {
      yield* drain()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { type: 'error', kind: classifyErrorMessage(message), message }
    } finally {
      abort?.dispose()
    }

    yield { type: 'done', finalText, usage }

    async function* drain(): AsyncGenerator<AgentEvent> {
      for await (const message of stream) {
        config.onRawEvent?.(message)

        switch (message.type) {
          case 'system': {
            if (message.subtype === 'init') {
              agentSession.sessionId = message.session_id
              yield { type: 'session_started', sessionId: message.session_id }
            }
            break
          }

          case 'stream_event': {
            const event = message.event as {
              type?: string
              delta?: { type?: string; text?: string }
            }
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              yield { type: 'text_delta', text: event.delta.text ?? '' }
            }
            break
          }

          case 'assistant': {
            if (message.error) {
              emittedError = true
              yield {
                type: 'error',
                kind: classifyClaudeError(message.error),
                message: `The model returned ${message.error}.`
              }
            }
            for (const block of (message.message.content ?? []) as ContentBlock[]) {
              if (block.type === 'text' && block.text) {
                finalText = block.text
                yield { type: 'text_message', text: block.text }
              } else if (block.type === 'tool_use' && block.id && block.name) {
                toolNames.set(block.id, block.name)
                yield {
                  type: 'tool_start',
                  toolCallId: block.id,
                  name: block.name,
                  detail: toolDetail(block.input)
                }
              }
            }
            break
          }

          case 'user': {
            // Tool results come back as blocks on a synthetic user message.
            const content = message.message.content
            if (!Array.isArray(content)) break
            for (const block of content as ContentBlock[]) {
              if (block.type !== 'tool_result' || !block.tool_use_id) continue
              yield {
                type: 'tool_end',
                toolCallId: block.tool_use_id,
                // The result block doesn't repeat the tool name, so it comes
                // from the tool_use that opened this id. Empty only if the
                // start was never seen, which would mean a malformed stream.
                name: toolNames.get(block.tool_use_id) ?? '',
                status: block.is_error ? 'failed' : 'completed',
                ...(toolResultExcerpt(block.content)
                  ? { output: toolResultExcerpt(block.content) }
                  : {})
              }
            }
            break
          }

          case 'tool_progress': {
            yield {
              type: 'tool_progress',
              toolCallId: message.tool_use_id,
              name: message.tool_name,
              elapsedMs: Math.round(message.elapsed_time_seconds * 1000)
            }
            break
          }

          case 'result': {
            usage = usageFromResult(message)

            for (const denial of message.permission_denials ?? []) {
              emittedError = true
              yield {
                type: 'error',
                kind: 'sandbox_denied',
                // The target is named because without it the message is not
                // actionable by anyone — the user cannot tell a persona that
                // reached outside its repo from one whose own working directory
                // was not granted, and those want opposite fixes. At
                // ask_writes most denials are answered asks, so the wording
                // says "not approved" — "does not allow" would tell the user
                // their own click was a sandbox malfunction.
                message:
                  spec.persona.sandbox === 'ask_writes'
                    ? `${denial.tool_name} was not approved, so it did not run.${deniedTarget(denial.tool_input)}`
                    : `Blocked ${denial.tool_name}: this persona's sandbox does not allow it.${deniedTarget(denial.tool_input)}`
              }
            }

            if (message.subtype === 'success') {
              // The CLI reports some failures as a *successful* result whose
              // text is its own error prose — a model this account cannot use,
              // most visibly. Left on the reply path it renders as an ordinary
              // bubble, becomes the sidebar preview, and never offers retry — so
              // it goes down the error path instead.
              if (message.is_error) {
                emittedError = true
                yield {
                  type: 'error',
                  kind: classifyErrorMessage(message.result),
                  message: rewordCliErrorProse(message.result)
                }
              } else if (message.result) {
                finalText = message.result
              }
            } else if (!emittedError) {
              yield {
                type: 'error',
                kind: 'unknown',
                message: message.errors?.join('; ') || `The turn ended: ${message.subtype}.`
              }
            }
            break
          }

          default:
            // The SDKMessage union has upwards of 35 variants and grows with
            // every release. Anything we don't model is not an error.
            break
        }
      }
    }
  }

  /**
   * One schema-constrained turn: the compaction summary a session is asked for
   * as it ends.
   *
   * Three things here are not obvious from run() and are load-bearing:
   *
   * - `outputFormat` sits in `options`, i.e. it is **session-level**. That is
   *   why compaction cannot be a flag on run(): an existing conversational
   *   session cannot be asked for JSON on its final turn.
   * - The answer is read from `structured_output`, **not** `result`. Both
   *   carry it on a successful turn, but `result` is the JSON serialized to a
   *   *string* — and run() maps `result` to `done.finalText`, so a caller
   *   reusing that path would persist raw JSON into the Group where a sentence
   *   belongs. (A live capture also settles what sdk.d.ts:1860-1866 means by a
   *   placeholder: it is the tool_result carrier *inside the transcript*,
   *   whose content is "Structured output provided successfully". That matters
   *   for forking a session, not for reading its answer.)
   * - `error_max_structured_output_retries` means the SDK already retried and
   *   gave up. That is a null answer, not an exception: the user's turn is long
   *   since committed and a missing Group entry is the correct degradation.
   *
   * No sandbox, no tools, no repo access — it reads a finished transcript that
   * is handed to it in the prompt. `disallowedTools` is belt and braces on top
   * of a persona spec the caller is expected to build read-only anyway.
   */
  async function summarize(
    agentSession: AgentSession,
    prompt: string,
    schema: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<StructuredResult> {
    const { spec } = agentSession
    const abort = signal ? abortControllerFor(signal) : null

    try {
      const stream = query({
        prompt,
        options: {
          cwd: spec.repoPath,
          ...(config.claudeBinaryPath
            ? { pathToClaudeCodeExecutable: config.claudeBinaryPath }
            : {}),
          systemPrompt: composeInstructions(spec),
          settingSources: [],
          // No mcpServers, deliberately — see SUMMARY_DISALLOWED_TOOLS below.
          // strictMcpConfig is still set, so a repo .mcp.json cannot supply one
          // through the back door on the one path that has no canUseTool.
          strictMcpConfig: true,
          outputFormat: { type: 'json_schema', schema },
          disallowedTools: SUMMARY_DISALLOWED_TOOLS,
          env: { ...process.env, ...config.env } as Record<string, string>,
          ...(spec.model ? { model: spec.model } : {}),
          ...(abort ? { abortController: abort.controller } : {}),
          stderr: (data: string) => config.onRawEvent?.({ type: 'stderr', data })
        }
      })

      let data: unknown | null = null
      let usage: AgentUsage | null = null

      for await (const message of stream) {
        config.onRawEvent?.(message)
        if (message.type !== 'result') continue

        usage = usageFromResult(message)
        if (message.subtype === 'success') data = message.structured_output ?? null
      }

      return { data, usage }
    } catch (error) {
      // Same contract as the null above: compaction never fails a turn that has
      // already been persisted. The caller logs; the raw hook is what makes a
      // swallowed failure diagnosable from `probe:structured --raw`.
      config.onRawEvent?.({ type: 'summarize_error', error: String(error) })
      return { data: null, usage: null }
    } finally {
      abort?.dispose()
    }
  }

  return {
    backend: 'claude',
    capabilities: CLAUDE_CAPABILITIES,
    createSession: (spec) => session(spec, null),
    resume: (spec, sessionId) => session(spec, sessionId),
    run,
    summarize
  }
}

/**
 * A summariser reads the prompt it was given and nothing else. Named
 * explicitly rather than derived from the sandbox level so that widening
 * `sandbox.ts` later cannot quietly hand the summariser filesystem access.
 *
 * The MCP names are here for exactly that reason. The summariser is never
 * passed `mcpServers`, so today no `mcp__*` tool exists in its session at all —
 * but a list of bare tool names could never match a qualified MCP name, and a
 * guard that looks like it covers a case it does not cover is worse than no
 * guard. It runs after every single turn; an MCP handshake per turn is a cost
 * nobody asked for, and a summariser that could comment on an issue is a
 * capability nobody granted.
 */
const SUMMARY_DISALLOWED_TOOLS = [
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Read',
  'WebFetch',
  'WebSearch',
  'Write',
  ...GITHUB_MCP_ALL_TOOLS.map(qualifiedGithubToolName)
]

/**
 * The SDK takes an AbortController, callers hand us an AbortSignal.
 *
 * `dispose` matters because a caller's signal can outlive one turn: a
 * conversation holds a single signal across every turn it runs. A listener that
 * only unregisters when it fires would accumulate one dead controller per turn
 * on any signal that never aborts, which is the common case.
 */
/**
 * The path or command a denied tool call was aiming at, if it named one.
 *
 * Best-effort by design: the SDK hands back the raw tool input, and tools name
 * their target differently. Anything unrecognised yields nothing rather than a
 * guess, because a wrong path in this message is worse than no path.
 */
function deniedTarget(input: Record<string, unknown>): string {
  for (const field of ['file_path', 'path', 'notebook_path', 'command']) {
    const value = input[field]
    if (typeof value === 'string' && value.trim() !== '') return ` Refused: ${value}`
  }
  return ''
}

function abortControllerFor(signal: AbortSignal): {
  controller: AbortController
  dispose: () => void
} {
  const controller = new AbortController()
  const forward = (): void => controller.abort()

  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', forward, { once: true })

  return { controller, dispose: () => signal.removeEventListener('abort', forward) }
}
