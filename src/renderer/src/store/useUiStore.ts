import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ThemePreference } from '@/lib/theme'

export type { ThemePreference }

/**
 * Which workspace the shell is showing.
 *
 * All but one are master-detail: the resizable list panel on the left, its
 * detail view on the right. `home` is the exception and has no list — it is a
 * summary of everything, so a master list would be a list of what exactly? See
 * AppShell, which drops the panel for it.
 */
export type Section = 'home' | 'chats' | 'personas' | 'skills' | 'routines' | 'usage' | 'branches'

export type ConversationSelection =
  { kind: 'contact'; id: string } | { kind: 'group'; id: string } | null

/** Which branch the Branches panel has open, if any. */
export type BranchSelection = { repoPath: string; branch: string } | null

/**
 * What the usage dashboard is scoped to.
 *
 * Persona and repo are the two axes blueprint §10 asks for, and they are the
 * two a Contact sits at the intersection of — so they belong in the master
 * list, leaving the detail pane for the range, source and metric controls
 * rather than stacking six filters into one header.
 */
export type UsageScope =
  { kind: 'all' } | { kind: 'persona'; id: string } | { kind: 'repo'; repoPath: string }

/**
 * The surfaces that stay genuinely modal — everything else is a view.
 *
 * `command` joins them because the palette is the same shape of thing: a short
 * decision you finish and dismiss, not a place you work.
 */
export type ModalDialog = 'newContact' | 'github' | 'command' | 'settings' | null

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

  /**
   * When set, the new-contact dialog opens prefilled from this contact — the
   * guided recreate (Phase 17). Repo and isolation are immutable on a live
   * contact, so "change" means "make a new one like it"; this makes that a
   * thirty-second act instead of a memory test. Cleared when the dialog closes.
   */
  recreateContactId: string | null
  setRecreateContactId: (id: string | null) => void

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
      // Launches on Home rather than Chats. `section` is not persisted, so this
      // *is* the launch screen — and Chats with nothing selected was only ever
      // showing the overview as a fall-through anyway.
      section: 'home',
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

      recreateContactId: null,
      setRecreateContactId: (recreateContactId) => set({ recreateContactId }),

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
