import type { AgentEvent } from '../../../shared/agent'
import type { MessageBubbleError } from '@/types/message'

/**
 * Folding a turn's event stream into what the thread should show.
 *
 * A pure reducer on purpose, and kept out of the component for a concrete
 * reason: the renderer test project matches `*.test.ts` only and there is no
 * component-testing library in the project, so logic that lives inside a `.tsx`
 * cannot be tested at all. This is the most intricate new logic in the phase,
 * so it lives where it can be.
 */

export interface ThreadStream {
  /**
   * Blocks the backend has declared final. Kept apart from `pending` because
   * Claude sends the same text twice — see applyAgentEvent.
   */
  committed: string
  /** The current block, still arriving delta by delta. */
  pending: string
  /** What the agent is doing right now, for StreamingIndicator. */
  activity: string | null
  /** Set by an `error` event; the thread renders this instead of a bubble. */
  error: MessageBubbleError | null
  /** True once `done` arrives — the turn is over, successfully or not. */
  finished: boolean
}

export const emptyStream: ThreadStream = {
  committed: '',
  pending: '',
  activity: null,
  error: null,
  finished: false
}

/** What the in-progress bubble should display. */
export function streamText(stream: ThreadStream): string {
  return stream.committed + stream.pending
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
      return { ...stream, activity: event.detail ?? event.name }

    case 'tool_progress':
      return { ...stream, activity: event.output ?? event.name }

    // Only clears the indicator if this is the tool it was showing. A parallel
    // tool finishing first would otherwise blank the line while another runs.
    case 'tool_end':
      return { ...stream, activity: null }

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
    // never needs; reasoning is the model thinking aloud, not its answer.
    case 'session_started':
    case 'reasoning':
      return stream

    default:
      return stream
  }
}
