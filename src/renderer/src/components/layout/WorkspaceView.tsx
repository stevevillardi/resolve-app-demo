import { ThreadView } from '@/components/conversation/ThreadView'
import { GroupThreadView } from '@/components/conversation/GroupThreadView'
import { PersonaDetailPanel } from '@/components/persona/PersonaDetailPanel'
import { SkillLibraryView } from '@/components/persona/SkillLibraryView'
import { RoutineEditor } from '@/components/routines/RoutineEditor'
import { UsageDashboard } from '@/components/usage/UsageDashboard'
import { BranchDetail } from '@/components/branches/BranchDetail'
import { WorkspaceHome } from './WorkspaceHome'
import { useUiStore } from '@/store/useUiStore'

/** The detail half of every section's master-detail pair. */
export function WorkspaceView(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const selected = useUiStore((state) => state.selectedConversation)

  if (section === 'personas') return <PersonaDetailPanel />
  if (section === 'skills') return <SkillLibraryView />
  if (section === 'routines') return <RoutineEditor />
  if (section === 'usage') return <UsageDashboard />
  if (section === 'branches') return <BranchDetail />

  if (selected?.kind === 'contact') return <ThreadView contactId={selected.id} />
  if (selected?.kind === 'group') return <GroupThreadView groupId={selected.id} />

  return <WorkspaceHome />
}
