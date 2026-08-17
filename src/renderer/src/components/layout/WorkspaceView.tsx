import { ThreadView } from '@/components/conversation/ThreadView'
import { GroupThreadView } from '@/components/conversation/GroupThreadView'
import { PersonaDetailPanel } from '@/components/persona/PersonaDetailPanel'
import { SkillLibraryView } from '@/components/persona/SkillLibraryView'
import { RoutineEditor } from '@/components/routines/RoutineEditor'
import { UsageDashboard } from '@/components/usage/UsageDashboard'
import { BranchDetail } from '@/components/branches/BranchDetail'
import { WorkspaceHome } from './WorkspaceHome'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { useUiStore, type ConversationSelection, type Section } from '@/store/useUiStore'

/** The detail half of every section's master-detail pair. */
export function WorkspaceView(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const selected = useUiStore((state) => state.selectedConversation)

  // Keyed on the section, so a pane that throws is not a screen you are stuck
  // on: switching away and back is a fresh attempt. Boundary here rather than
  // inside each view so the nav rail and the list panel stay usable, which is
  // what makes "switch away" possible in the first place.
  return (
    <ErrorBoundary variant="pane" resetKey={section}>
      {view(section, selected)}
    </ErrorBoundary>
  )
}

function view(section: Section, selected: ConversationSelection): React.JSX.Element {
  if (section === 'personas') return <PersonaDetailPanel />
  if (section === 'skills') return <SkillLibraryView />
  if (section === 'routines') return <RoutineEditor />
  if (section === 'usage') return <UsageDashboard />
  if (section === 'branches') return <BranchDetail />

  if (selected?.kind === 'contact') return <ThreadView contactId={selected.id} />
  if (selected?.kind === 'group') return <GroupThreadView groupId={selected.id} />

  return <WorkspaceHome />
}
