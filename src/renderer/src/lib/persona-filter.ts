import { scoreCommand } from './command-palette'
import type { PersonaTemplate } from '@/types'

/**
 * Filtering the persona list in the new-contact flow.
 *
 * The same shape as `filterRepos`, and for the same reason: the persona step
 * was an unbounded, unranked list in a dialog showing about four rows at a
 * time. That was fine while the only personas were the three the starter
 * library seeds, and stops being fine the moment anyone opens the library's
 * other five or writes their own — which is the point of having a library.
 *
 * Ranking is `scoreCommand`'s rather than a third implementation of the same
 * idea. Backend and sandbox ride along as `detail` so that typing `codex` or
 * `read_only` narrows the list to personas that are those things — the two
 * facts a reader is actually choosing between, and the two the row already
 * shows as badges. Matching only the name would mean the visible text and the
 * searchable text disagreed.
 */
export function filterPersonas(personas: PersonaTemplate[], query: string): PersonaTemplate[] {
  const needle = query.trim()
  if (!needle) return personas

  return (
    personas
      .map((persona, index) => ({
        persona,
        index,
        score: scoreCommand(
          {
            id: persona.id,
            group: 'Personas',
            label: persona.name,
            detail: `${persona.backend} ${persona.sandbox} ${persona.githubScope}`
          },
          needle
        )
      }))
      .filter((entry) => entry.score > 0)
      // Ties keep the incoming order, which is the order `personas.list`
      // returns and therefore the order the step shows without a query. A
      // filter that reshuffled equal matches would make the list appear to
      // jump for no reason as the user typed.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.persona)
  )
}

/**
 * Below this the step shows no filter box at all.
 *
 * A search field over four rows is furniture: it costs a row of vertical space
 * in a dialog that is already tight, to save a decision nobody has to make. The
 * seeded default is three personas, so a fresh profile never sees it.
 */
export const PERSONA_FILTER_THRESHOLD = 6
