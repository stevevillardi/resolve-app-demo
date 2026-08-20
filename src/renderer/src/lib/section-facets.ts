import { repoName } from './format'
import type { FacetSpec } from './list-filter'
import type { Contact, PersonaTemplate } from '@/types'

/**
 * Which chips each rail offers, and what is in them (Phase 26 §A2).
 *
 * Pure and in `lib/` so it can be tested — the renderer Vitest project matches
 * `*.test.ts` only — and because the interesting part is not the rendering but
 * *which options exist*, which is derived from live data and has real rules:
 * a repo nobody is bound to is not a filter anyone needs, and a facet with one
 * option is not rendered at all (`FACET_MIN_OPTIONS`).
 *
 * Only the specs live here. What a *row* matches is the other half of a facet
 * and lives with the list that owns the row type — see `FacetValues`. The two
 * agree by sharing the ids below, which is why they are constants rather than
 * string literals typed twice.
 */

export const FACET_REPO = 'repo'
export const FACET_PERSONA = 'persona'
export const FACET_BACKEND = 'backend'
export const FACET_SANDBOX = 'sandbox'
export const FACET_STATE = 'state'

/** Values for the `state` facet. One namespace per section; they never mix. */
export const STATE_UNREAD = 'unread'
export const STATE_UNMERGED = 'unmerged'
export const STATE_UNCOMMITTED = 'uncommitted'
export const STATE_ORPHANED = 'orphaned'
export const STATE_UNUSED = 'unused'
export const STATE_ATTACHED = 'attached'
export const STATE_UNATTACHED = 'unattached'
export const STATE_PAUSED = 'paused'
export const STATE_MISSED = 'missed'

/**
 * The repositories worth offering, from the paths actually in use.
 *
 * Labelled by last path segment, which is how every row already shows a repo —
 * but **de-duplicated on the full path**, so two checkouts both called `api`
 * stay two options. That is the collision this app is one `git clone` away
 * from, and collapsing them would silently filter to both.
 */
export function repoFacet(repoPaths: string[]): FacetSpec {
  const unique = [...new Set(repoPaths)].sort((a, b) => repoName(a).localeCompare(repoName(b)))
  const labels = unique.map(repoName)

  return {
    id: FACET_REPO,
    label: 'Repo',
    options: unique.map((path, index) => ({
      value: path,
      // Only the ambiguous ones pay for the disambiguation. A parenthesised
      // parent directory on every row would be noise on the common case.
      label:
        labels.filter((name) => name === labels[index]).length > 1
          ? `${labels[index]} (${parentName(path)})`
          : (labels[index] as string)
    }))
  }
}

function parentName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 2] ?? path
}

/**
 * The personas worth offering — those with at least one contact.
 *
 * A persona nobody has bound is a template, not a filter: selecting it could
 * only ever empty the list, which reads as a broken chip rather than as an
 * honest zero.
 */
export function personaFacet(personas: PersonaTemplate[], contacts: Contact[]): FacetSpec {
  const inUse = new Set(contacts.map((contact) => contact.personaTemplateId))

  return {
    id: FACET_PERSONA,
    label: 'Persona',
    options: personas
      .filter((persona) => inUse.has(persona.id))
      .map((persona) => ({ value: persona.id, label: persona.name }))
  }
}

export function backendFacet(personas: PersonaTemplate[]): FacetSpec {
  const present = new Set(personas.map((persona) => persona.backend))

  return {
    id: FACET_BACKEND,
    label: 'Backend',
    options: [
      { value: 'claude', label: 'Claude' },
      { value: 'codex', label: 'Codex' }
      // Derived from what exists rather than hardcoded to both, so a profile
      // running only Claude never sees a chip whose other half is empty.
    ].filter((option) => present.has(option.value as PersonaTemplate['backend']))
  }
}

export function sandboxFacet(personas: PersonaTemplate[]): FacetSpec {
  const present = new Set(personas.map((persona) => persona.sandbox))

  return {
    id: FACET_SANDBOX,
    label: 'Disk',
    options: [
      { value: 'read_only', label: 'Read only' },
      { value: 'workspace_write', label: 'Write' },
      { value: 'full_access', label: 'Full access' }
    ].filter((option) => present.has(option.value as PersonaTemplate['sandbox']))
  }
}

/**
 * A `state` facet built only from the states actually present.
 *
 * "Paused" is worth offering when something is paused and is a dead chip when
 * nothing is. Passing the counts rather than a boolean keeps that decision here
 * instead of repeated at each call site.
 */
export function stateFacet(
  label: string,
  candidates: { value: string; label: string; present: boolean }[]
): FacetSpec {
  return {
    id: FACET_STATE,
    label,
    options: candidates
      .filter((candidate) => candidate.present)
      .map(({ value, label: optionLabel }) => ({ value, label: optionLabel }))
  }
}
