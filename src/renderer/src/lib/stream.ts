import type { AgentEvent } from '../../../shared/agent'
import type { MessageBubbleError } from '@/types/message'

/**
 * Folding a turn's event stream into what the thread should show.
 *
 * A pure reducer on purpose, and kept out of the component for a concrete
 * reason: the renderer test project matches `*.test.ts` only and there is no
 * component-testing library in the project, so logic that lives inside a `.tsx`
 * cannot be tested at all. This is the most intricate logic behind the thread
 * view, so it lives where it can be tested.
 */

/**
 * One tool call, as it happens.
 *
 * An ordered array rather than a map keyed by `toolCallId`: a timeline is a
 * sequence, and object key-insertion order is an implementation detail this
 * codebase states nowhere. Lookups are a `find` over a handful of entries.
 */
export interface ToolCall {
  id: string
  name: string
  /** The command line, the path, the query — whatever the backend named. */
  detail: string
  /** How it answered — the bounded excerpt `tool_end` carried. */
  output?: string
  status: 'running' | 'completed' | 'failed'
}

export interface ThreadStream {
  /**
   * Blocks the backend has declared final. Kept apart from `pending` because
   * Claude sends the same text twice — see applyAgentEvent.
   */
  committed: string
  /** The current block, still arriving delta by delta. */
  pending: string
  /**
   * Every tool call this turn has made, in the order they started.
   *
   * Live only, and dropped when the turn's persisted rows are refetched. The
   * honest consequence is stated rather than hidden: whatever this array held
   * and main did not write down is gone the moment the turn ends, so a turn
   * nobody watched can leave a record of what it concluded and none of what it
   * called.
   */
  toolCalls: ToolCall[]
  /** What the agent is doing right now, for StreamingIndicator. */
  activity: string | null
  /** Set by an `error` event; the thread renders this instead of a bubble. */
  error: MessageBubbleError | null
  /** True once `done` arrives — the turn is over, successfully or not. */
  finished: boolean
  /**
   * The model thinking aloud, accumulated for the streaming bubble's
   * collapsed disclosure. Live only, like toolCalls — never
   * persisted, dropped when end() clears the turn. Codex is the only backend
   * that emits the event; on Claude this simply stays empty.
   */
  reasoning: string
}

export const emptyStream: ThreadStream = {
  committed: '',
  pending: '',
  toolCalls: [],
  activity: null,
  error: null,
  finished: false,
  reasoning: ''
}

/** What the in-progress bubble should display. */
export function streamText(stream: ThreadStream): string {
  return stream.committed + stream.pending
}

/**
 * `mcp__github__list_issues` → `github · list_issues`.
 *
 * The qualified name is how both the SDK and the deny list refer to a tool, so
 * it is the right thing to key on and the wrong thing to read. Which *server* a
 * call went to survives the shortening rather than being trimmed away with the
 * prefix: that is the part a human is governing, and two servers offering a
 * `search` tool would otherwise render identically.
 *
 * Non-MCP names are returned untouched — `Bash` and `Edit` are already what
 * they should read as.
 */
export function toolCallLabel(name: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? `${match[1]} · ${match[2]}` : name
}

/**
 * Replaces one call by id, copying rather than mutating.
 *
 * The purity guard in stream.test.ts is not decoration: `applyAgentEvent` is
 * folded into Zustand state, and mutating an entry in place would leave the
 * store holding an object React has already decided is unchanged.
 */
function patchCall(
  calls: ToolCall[],
  id: string,
  update: (call: ToolCall) => ToolCall
): ToolCall[] {
  return calls.map((call) => (call.id === id ? update(call) : call))
}

/**
 * Applies one event, returning fresh state.
 *
 * The subtlety is the delta/message overlap. Claude emits the deltas for a
 * block and then emits that same block again whole, so a fold that appended
 * both would render every reply twice. Codex emits no deltas at all and only
 * whole messages. Splitting the buffer handles both without branching on which
 * backend is talking: deltas accumulate into `pending`, and a whole message
 * commits and clears it — for Claude that replaces the text it had been
 * building, for Codex it is simply the next block.
 */
export function applyAgentEvent(stream: ThreadStream, event: AgentEvent): ThreadStream {
  switch (event.type) {
    case 'text_delta':
      return { ...stream, pending: stream.pending + event.text }

    case 'text_message':
      return { ...stream, committed: stream.committed + event.text, pending: '' }

    case 'tool_start':
      return {
        ...stream,
        toolCalls: [
          ...stream.toolCalls,
          {
            id: event.toolCallId,
            name: event.name,
            detail: event.detail ?? '',
            status: 'running'
          }
        ],
        activity: event.detail ?? event.name
      }

    case 'tool_progress':
      return {
        ...stream,
        toolCalls: patchCall(stream.toolCalls, event.toolCallId, (call) => ({
          ...call,
          // Progress carries the latest output, which is more use in the
          // timeline than the command that produced it.
          detail: event.output ?? call.detail
        })),
        activity: event.output ?? event.name
      }

    /**
     * Clears the indicator only if this is the tool it was showing.
     *
     * The comment above this arm claimed exactly that for three phases while
     * the code ignored `toolCallId` and cleared unconditionally, so the first
     * of two parallel calls to finish blanked the line while the other still
     * ran. Deriving `activity` from what is still running makes the claim and
     * the code the same thing rather than two statements that can disagree.
     */
    case 'tool_end': {
      const toolCalls = patchCall(stream.toolCalls, event.toolCallId, (call) => ({
        ...call,
        status: event.status,
        detail: event.detail ?? call.detail,
        ...(event.output ? { output: event.output } : {})
      }))
      const running = toolCalls.filter((call) => call.status === 'running')

      return {
        ...stream,
        toolCalls,
        activity: running.length === 0 ? null : (running.at(-1)?.detail ?? running.at(-1)!.name)
      }
    }

    case 'error':
      return { ...stream, error: { kind: event.kind, message: event.message } }

    /**
     * `finalText` is authoritative — it is the backend's own answer, and it is
     * what main persisted. Adopting it here means the bubble the user watched
     * being built matches the row that gets refetched a moment later, even if
     * the stream dropped an event on the way.
     */
    case 'done':
      return {
        ...stream,
        committed: event.finalText || streamText(stream),
        pending: '',
        activity: null,
        finished: true
      }

    // session_started carries the resume key, which main persists and the UI
    // never needs.
    case 'session_started':
      return stream

    // Not the answer, but for a long tool turn it is the only sign of life —
    // kept for the streaming bubble's disclosure and discarded with the rest
    // of the live state when the turn's rows land.
    case 'reasoning':
      return {
        ...stream,
        reasoning: stream.reasoning ? `${stream.reasoning}\n\n${event.text}` : event.text
      }

    default:
      return stream
  }
}
