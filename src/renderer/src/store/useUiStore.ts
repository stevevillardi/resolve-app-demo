import { create } from 'zustand'

export type ConversationSelection =
  { kind: 'contact'; id: string } | { kind: 'group'; id: string } | null

export type ThemePreference = 'system' | 'light' | 'dark'

interface UiState {
  selectedConversation: ConversationSelection
  setSelectedConversation: (selection: ConversationSelection) => void
  themePreference: ThemePreference
  setThemePreference: (preference: ThemePreference) => void
}

// Local-only, ephemeral UI state — never persisted, never touches IPC.
export const useUiStore = create<UiState>((set) => ({
  selectedConversation: null,
  setSelectedConversation: (selection) => set({ selectedConversation: selection }),
  themePreference: 'system',
  setThemePreference: (preference) => set({ themePreference: preference })
}))
