import { useEffect } from 'react'
import { useUiStore } from '@/store/useUiStore'

/**
 * Binds ⌘K / Ctrl+K to the command palette.
 *
 * Toggles rather than only opening, so the same chord that summons it also
 * dismisses it. ⌘B is already taken by the sidebar (see SidebarProvider), and
 * ⌘K is the convention users arrive with, so the two do not collide.
 *
 * Registered on `window` in the capture phase: the palette can be opened from
 * anywhere, including while focus is inside a textarea, and a bubbling listener
 * would be beaten by any component that stops propagation on its own keydown.
 */
export function useCommandPalette(): void {
  const setDialog = useUiStore((state) => state.setDialog)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      // Read through the store rather than subscribing to `dialog` here — this
      // effect would otherwise re-bind on every dialog change.
      const { dialog } = useUiStore.getState()
      setDialog(dialog === 'command' ? null : 'command')
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [setDialog])
}
