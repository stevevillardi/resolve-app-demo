import { create } from 'zustand'

interface UiState {
  activeContactId: string | null
  setActiveContactId: (id: string | null) => void
}

// Local-only, ephemeral UI state — never persisted, never touches IPC.
// Real usage starts in Phase 2 (sidebar selection); this is just proof it's wired.
export const useUiStore = create<UiState>((set) => ({
  activeContactId: null,
  setActiveContactId: (id) => set({ activeContactId: id })
}))
