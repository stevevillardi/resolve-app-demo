import { MessagesSquare } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ThreadView } from '@/components/conversation/ThreadView'
import { GroupThreadView } from '@/components/conversation/GroupThreadView'
import { EmptyState } from '@/components/common/EmptyState'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useUiStore } from '@/store/useUiStore'

export function AppShell(): React.JSX.Element {
  useThemeSync()
  const selected = useUiStore((state) => state.selectedConversation)

  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden">
      <Sidebar className="border-border w-72 shrink-0 border-r" />
      <main className="min-w-0 flex-1">
        {selected?.kind === 'contact' && <ThreadView contactId={selected.id} />}
        {selected?.kind === 'group' && <GroupThreadView groupId={selected.id} />}
        {!selected && (
          <EmptyState
            icon={MessagesSquare}
            title="Select a conversation"
            description="Pick a contact or a group from the sidebar to get started."
          />
        )}
      </main>
    </div>
  )
}
