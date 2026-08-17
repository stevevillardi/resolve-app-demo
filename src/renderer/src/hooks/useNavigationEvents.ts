import { useEffect } from 'react'
import { onNavigate } from '@/lib/ipc-client'
import { useUiStore } from '@/store/useUiStore'

/**
 * Maps main's navigate targets onto the same store transitions the sidebar
 * uses — a notification click is a third entrance to a conversation, not a
 * second selection mechanism. Main shows the window before sending (see
 * navigateTo), so by the time a target arrives the shell is on screen.
 */
export function useNavigationEvents(): void {
  const setSection = useUiStore((state) => state.setSection)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)

  useEffect(
    () =>
      onNavigate((target) => {
        if (target.kind === 'home') {
          setSection('home')
          return
        }
        setSection('chats')
        setSelectedConversation(
          target.kind === 'contact'
            ? { kind: 'contact', id: target.contactId }
            : { kind: 'group', id: target.groupId }
        )
      }),
    [setSection, setSelectedConversation]
  )
}
