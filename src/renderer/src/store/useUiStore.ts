import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ThemePreference } from '@/lib/theme'

export type { ThemePreference }

/** Which workspace the shell is showing. Each one is master-detail: the
 *  resizable list panel on the left, its detail view on the right. */
export type Section = 'chats' | 'personas' | 'skills' | 'routines' | 'usage' | 'branches'

export type ConversationSelection =
  { kind: 'contact'; id: string } | { kind: 'group'; id: string } | null

/** Which branch the Branches panel has open, if any. */
export type BranchSelection = { repoPath: string; branch: string } | null

/** What the usage dashboard is scoped to. */
export type UsageScope = { kind: 'all' } | { kind: 'persona'; id: string }

/**
 * The surfaces that stay genuinely modal — everything else is a view.
 *
 * `command` joins them because the palette is the same shape of thing: a short
 * decision you finish and dismiss, not a place you work.
 */
export type ModalDialog = 'newContact' | 'github' | 'command' | null

interface UiState {
  section: Section
  setSection: (section: Section) => void

  /** Whether the nav rail is expanded to show labels (⌘B). */
  navExpanded: boolean
  setNavExpanded: (expanded: boolean) => void

  selectedConversation: ConversationSelection
  setSelectedConversation: (selection: ConversationSelection) => void

  selectedPersonaId: string | null
  setSelectedPersonaId: (id: string | null) => void

  selectedSkillId: string | null
  setSelectedSkillId: (id: string | null) => void

  selectedRoutineId: string | null
  setSelectedRoutineId: (id: string | null) => void

  /**
   * Keyed by repo as well as name, because branch names are only unique within
   * a repository — two repos can each have a `persona/refactor-buddy-a3f9`.
   */
  selectedBranch: BranchSelection
  setSelectedBranch: (selection: BranchSelection) => void

  usageScope: UsageScope
  setUsageScope: (scope: UsageScope) => void

  dialog: ModalDialog
  setDialog: (dialog: ModalDialog) => void

  themePreference: ThemePreference
  setThemePreference: (preference: ThemePreference) => void
}

// Local-only UI state — never touches IPC. Only the two chrome preferences are
// persisted; selection stays ephemeral per blueprint §10 (a relaunch should
// land on the empty state, not resurrect a stale conversation id). Pane widths
// are persisted separately by react-resizable-panels' own autoSaveId.
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      section: 'chats',
      setSection: (section) => set({ section }),

      navExpanded: false,
      setNavExpanded: (navExpanded) => set({ navExpanded }),

      selectedConversation: null,
      setSelectedConversation: (selectedConversation) => set({ selectedConversation }),

      selectedPersonaId: null,
      setSelectedPersonaId: (selectedPersonaId) => set({ selectedPersonaId }),

      selectedSkillId: null,
      setSelectedSkillId: (selectedSkillId) => set({ selectedSkillId }),

      selectedRoutineId: null,
      setSelectedRoutineId: (selectedRoutineId) => set({ selectedRoutineId }),

      selectedBranch: null,
      setSelectedBranch: (selectedBranch) => set({ selectedBranch }),

      usageScope: { kind: 'all' },
      setUsageScope: (usageScope) => set({ usageScope }),

      dialog: null,
      setDialog: (dialog) => set({ dialog }),

      themePreference: 'system',
      setThemePreference: (themePreference) => set({ themePreference })
    }),
    {
      name: 'persona-router-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        themePreference: state.themePreference,
        navExpanded: state.navExpanded
      })
    }
  )
)
