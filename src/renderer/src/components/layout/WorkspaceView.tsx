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
  if (section === 'home') return <WorkspaceHome />
  if (section === 'personas') return <PersonaDetailPanel />
  if (section === 'skills') return <SkillLibraryView />
  if (section === 'routines') return <RoutineEditor />
  if (section === 'usage') return <UsageDashboard />
  if (section === 'branches') return <BranchDetail />

  // Keyed on the conversation, so per-conversation component state (picker
  // dismissals, unread boundaries, the work-diff dialog) dies with a switch
  // instead of bleeding into the next thread. Drafts survive the remount on
  // purpose — they live in useDraftStore, not in the instance.
  if (selected?.kind === 'contact') return <ThreadView key={selected.id} contactId={selected.id} />
  if (selected?.kind === 'group') return <GroupThreadView key={selected.id} groupId={selected.id} />

  // Chats with nothing picked. Still shows what is running and what was said
  // last — that is the useful thing to see while deciding which conversation to
  // open — but not spend, which belongs to Home and to the Usage section.
  return <WorkspaceHome variant="chats" />
}
