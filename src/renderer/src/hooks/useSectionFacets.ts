import { useMemo } from 'react'
import {
  STATE_ATTACHED,
  STATE_MISSED,
  STATE_ORPHANED,
  STATE_PAUSED,
  STATE_UNATTACHED,
  STATE_UNCOMMITTED,
  STATE_UNMERGED,
  STATE_UNREAD,
  STATE_UNUSED,
  backendFacet,
  personaFacet,
  repoFacet,
  sandboxFacet,
  stateFacet
} from '@/lib/section-facets'
import { useBranches } from '@/hooks/useBranches'
import { useContacts, useGroups } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useRoutines } from '@/hooks/useRoutines'
import { useSkills } from '@/hooks/useSkills'
import { useUnread } from '@/hooks/useUnread'
import type { FacetSpec } from '@/lib/list-filter'
import type { Section } from '@/store/useUiStore'

/**
 * The chips the open rail should offer.
 *
 * One hook rather than a `facets` prop on each list, because the bar is drawn
 * by `ListPanel` — which owns the header — while the rows are drawn by the
 * list. Putting the derivation here keeps `ListPanel` from having to know what
 * a routine is, and keeps six components from each growing their own copy.
 *
 * Every query below is already fetched by the list it describes, so this costs
 * cache reads rather than round trips. It is deliberately *all* sections rather
 * than a switch over hooks: hooks cannot be called conditionally, and a
 * `useQuery` for a section that is closed is a cache hit with no request.
 *
 * The options are derived from live data throughout — see `section-facets.ts`
 * for why an empty facet is better than a hardcoded one.
 */
export function useSectionFacets(section: Section): FacetSpec[] {
  // The query results are held undefined-or-array and defaulted *inside* the
  // memo below. `useContacts().data ?? []` allocates a fresh array on every
  // render while the query is still loading, so the memo's dependency changes
  // every time and the memo never memoizes — which in a phase about the cost of
  // drawing a list would have been an unusually silly thing to ship.
  const contactsQuery = useContacts().data
  const groupsQuery = useGroups().data
  const personasQuery = usePersonas().data
  const routinesQuery = useRoutines().data
  const skillsQuery = useSkills().data
  const branchesQuery = useBranches().data
  const unread = useUnread()

  return useMemo(() => {
    const contacts = contactsQuery ?? []
    const groups = groupsQuery ?? []
    const personas = personasQuery ?? []
    const routines = routinesQuery ?? []
    const skills = skillsQuery ?? []
    const branches = branchesQuery ?? []

    switch (section) {
      case 'chats': {
        // Groups as well as contacts: a repo whose contacts were all deleted
        // still has a group row, and that row is exactly the one worth finding.
        const paths = [...contacts.map((c) => c.repoPath), ...groups.map((g) => g.repoPath)]
        return [
          repoFacet(paths),
          personaFacet(personas, contacts),
          stateFacet('Status', [{ value: STATE_UNREAD, label: 'Unread', present: unread.size > 0 }])
        ]
      }

      case 'branches':
        return [
          repoFacet(branches.map((branch) => branch.repoPath)),
          stateFacet('Status', [
            {
              value: STATE_UNMERGED,
              label: 'Not merged',
              present: branches.some((branch) => !branch.merged)
            },
            {
              value: STATE_UNCOMMITTED,
              label: 'Uncommitted work',
              present: branches.some((branch) => branch.dirtyFiles.length > 0)
            },
            {
              // The branches most at risk of being forgotten, and the reason
              // `listPersonaBranches` reads git rather than the contacts table.
              value: STATE_ORPHANED,
              label: 'No contact',
              present: branches.some((branch) => branch.contactId === null)
            }
          ])
        ]

      case 'personas': {
        const bound = new Set(contacts.map((contact) => contact.personaTemplateId))
        return [
          backendFacet(personas),
          sandboxFacet(personas),
          stateFacet('Status', [
            {
              value: STATE_UNUSED,
              label: 'No contacts',
              present: personas.some((persona) => !bound.has(persona.id))
            }
          ])
        ]
      }

      case 'skills': {
        const attached = new Set(personas.flatMap((persona) => persona.skillIds))
        return [
          stateFacet('Status', [
            {
              value: STATE_ATTACHED,
              label: 'In use',
              present: skills.some((skill) => attached.has(skill.id))
            },
            {
              value: STATE_UNATTACHED,
              label: 'Unused',
              present: skills.some((skill) => !attached.has(skill.id))
            }
          ])
        ]
      }

      case 'routines': {
        const contactOf = (id: string): (typeof contacts)[number] | undefined =>
          contacts.find((contact) => contact.id === id)
        const routineContacts = routines
          .map((routine) => contactOf(routine.contactId))
          .filter((contact): contact is (typeof contacts)[number] => contact !== undefined)

        return [
          repoFacet(routineContacts.map((contact) => contact.repoPath)),
          personaFacet(personas, routineContacts),
          stateFacet('Status', [
            {
              value: STATE_PAUSED,
              label: 'Paused',
              present: routines.some((routine) => !routine.enabled)
            },
            {
              value: STATE_MISSED,
              label: 'Missed a run',
              present: routines.some((routine) => routine.missedRunCount > 0)
            }
          ])
        ]
      }

      // Home renders no rail at all, and Usage answers scope with its own
      // dashboard controls — see the note on PANEL.usage in ListPanel.
      default:
        return []
    }
  }, [
    section,
    contactsQuery,
    groupsQuery,
    personasQuery,
    routinesQuery,
    skillsQuery,
    branchesQuery,
    unread
  ])
}
