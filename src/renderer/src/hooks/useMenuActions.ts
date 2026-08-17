import { useEffect } from 'react'
import { onMenuAction } from '@/lib/ipc-client'
import { useUiStore } from '@/store/useUiStore'

/**
 * Maps application-menu actions onto the same store transitions the buttons
 * use — the menu is a second entrance, not a second implementation. Main shows
 * the window before sending, so by the time an action arrives the shell is on
 * screen.
 */
export function useMenuActions(): void {
  const setDialog = useUiStore((state) => state.setDialog)

  useEffect(
    () =>
      onMenuAction((action) => {
        switch (action) {
          case 'new-contact':
            setDialog('newContact')
            break
          case 'command-palette':
            setDialog('command')
            break
          case 'open-settings':
            setDialog('settings')
            break
        }
      }),
    [setDialog]
  )
}
