import { create } from 'zustand'
import { applyAgentEvent, emptyStream, type ThreadStream } from '@/lib/stream'
import type { AgentEvent } from '../../../shared/agent'

/**
 * The turn currently in flight for each contact.
 *
 * A store rather than component state because ThreadView unmounts the moment
 * the user clicks another conversation, and a turn has to survive that — the
 * whole point of a persona working in the background is that you can go and
 * look at something else. On coming back the thread picks the stream up
 * mid-sentence.
 *
 * Deliberately not in useUiStore: that one persists to localStorage, and a
 * half-finished turn restored after a relaunch would be a lie — main will have
 * lost the run with the process that owned it.
 */

interface ActiveTurn {
  runId: string
  stream: ThreadStream
}

interface RunStore {
  byContact: Record<string, ActiveTurn>
  begin: (contactId: string, runId: string) => void
  apply: (contactId: string, event: AgentEvent) => void
  end: (contactId: string) => void
}

export const useRunStore = create<RunStore>((set) => ({
  byContact: {},

  begin: (contactId, runId) =>
    set((state) => ({
      byContact: { ...state.byContact, [contactId]: { runId, stream: emptyStream } }
    })),

  apply: (contactId, event) =>
    set((state) => {
      const turn = state.byContact[contactId]
      // An event for a contact with no active turn is a late arrival from one
      // already cleared — dropping it is correct, since the persisted rows are
      // the record and they are already written.
      if (!turn) return state

      return {
        byContact: {
          ...state.byContact,
          [contactId]: { ...turn, stream: applyAgentEvent(turn.stream, event) }
        }
      }
    }),

  /**
   * Drops the live stream once the persisted rows have been refetched.
   *
   * Called after invalidation rather than on `done`, so the bubble never
   * flickers: the streamed text stays on screen until the identical row from
   * SQLite is there to replace it.
   */
  end: (contactId) =>
    set((state) => {
      if (!state.byContact[contactId]) return state
      const next = { ...state.byContact }
      delete next[contactId]
      return { byContact: next }
    })
}))
