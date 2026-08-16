import { MessagesSquare } from 'lucide-react'
import { ThreadView } from '@/components/conversation/ThreadView'
import { GroupThreadView } from '@/components/conversation/GroupThreadView'
import { PersonaDetailPanel } from '@/components/persona/PersonaDetailPanel'
import { SkillLibraryView } from '@/components/persona/SkillLibraryView'
import { RoutineEditor } from '@/components/routines/RoutineEditor'
import { UsageDashboard } from '@/components/usage/UsageDashboard'
import { BranchDetail } from '@/components/branches/BranchDetail'
import { EmptyPane } from '@/components/common/EmptyPane'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/store/useUiStore'

/** The detail half of every section's master-detail pair. */
export function WorkspaceView(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const selected = useUiStore((state) => state.selectedConversation)
  const setDialog = useUiStore((state) => state.setDialog)

  if (section === 'personas') return <PersonaDetailPanel />
  if (section === 'skills') return <SkillLibraryView />
  if (section === 'routines') return <RoutineEditor />
  if (section === 'usage') return <UsageDashboard />
  if (section === 'branches') return <BranchDetail />

  if (selected?.kind === 'contact') return <ThreadView contactId={selected.id} />
  if (selected?.kind === 'group') return <GroupThreadView groupId={selected.id} />

  return (
    <EmptyPane
      icon={MessagesSquare}
      title="No conversation selected"
      description="Pick a contact to message one persona, or a repo group to see everything working in it."
      action={
        <Button variant="outline" size="sm" onClick={() => setDialog('newContact')}>
          New contact
        </Button>
      }
    />
  )
}
