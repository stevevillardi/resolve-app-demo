import { create } from 'zustand'

/**
 * The unsent composer text for each conversation.
 *
 * A store rather than component state because the thread views are keyed on
 * their conversation id — switching away unmounts them, and a half-typed
 * message has to survive the trip to another conversation and back. Before
 * this store the opposite bug existed: ThreadView was NOT keyed, so the same
 * component instance served every contact and one contact's draft bled into
 * the next.
 *
 * Deliberately not in useUiStore: that one persists to localStorage, and a
 * draft is working memory, not a setting — resurrecting week-old text after a
 * relaunch would be more surprising than losing it.
 */

interface DraftStore {
  /** Keyed `contact:<id>` / `group:<id>` so the two id spaces cannot collide. */
  byConversation: Record<string, string>
  setDraft: (key: string, value: string) => void
  clearDraft: (key: string) => void
}

export const draftKey = (kind: 'contact' | 'group', id: string): string => `${kind}:${id}`

export const useDraftStore = create<DraftStore>((set) => ({
  byConversation: {},

  setDraft: (key, value) =>
    set((state) => ({ byConversation: { ...state.byConversation, [key]: value } })),

  clearDraft: (key) =>
    set((state) => {
      if (!(key in state.byConversation)) return state
      const next = { ...state.byConversation }
      delete next[key]
      return { byConversation: next }
    })
}))
