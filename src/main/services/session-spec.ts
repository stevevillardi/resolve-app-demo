import { composeInstructions, orderSkills } from '../adapters/context'
import { capabilitiesFor } from './capabilities'
import { getContact } from './contacts'
import { contextForRepo } from './group-messages'
import { getPersonaTemplate } from './persona-templates'
import { workingPathFor } from './run-lock'
import { skillsForPersona } from './skills'
import { siblingBranchesFor } from './worktrees'
import type { SessionSpec } from '../adapters/types'
import type { Contact, PersonaTemplate } from '../../shared/domain'
import type { ContactContext } from '../../shared/ipc-contract'

/**
 * Everything a turn injects, resolved from the database and the filesystem.
 *
 * Extracted out of startTurn so that the "what is in my context" panel and the
 * turn itself cannot disagree. A panel that assembled its own copy would be
 * accurate exactly once — the first time either side changed, it would start
 * describing a prompt nobody sends, and nothing would fail to say so.
 *
 * `writablePaths` is deliberately not set here. It comes from ensureWorktree(),
 * which *creates* the checkout, and asking what a turn would send must not
 * bring one into existence. startTurn adds it after this returns.
 */
export function buildSessionSpec(
  contact: Contact,
  persona: PersonaTemplate,
  options: { workingPath: string; usageBaseline?: SessionSpec['usageBaseline'] } = {
    workingPath: ''
  }
): SessionSpec {
  // What this Contact may reach beyond its own working directory: MCP servers
  // narrowed to the persona's githubScope, plus whatever the repository itself
  // has been trusted to say. Resolved per turn like the group context, so
  // revoking trust or disconnecting GitHub takes effect on the next message
  // rather than the next restart.
  //
  // Resolved *here* rather than in startTurn so the context panel reports it
  // too. A capability the turn sends and the panel does not know about is
  // exactly the drift this function exists to make impossible.
  const capabilities = capabilitiesFor(contact, persona)

  return {
    persona,
    repoPath: options.workingPath || workingPathFor(contact),
    skills: skillsForPersona(persona),
    repoSkills: capabilities.nativeSkillNames,
    injectedSkills: capabilities.injectedSkills,
    mcpServers: capabilities.mcpServers,
    ...(capabilities.repoInstructions
      ? {
          repoInstructions: {
            fileName: capabilities.repoInstructions.fileName,
            content: capabilities.repoInstructions.content
          }
        }
      : {}),
    // Blueprint §5: what the rest of the fleet has decided on this repo.
    // Resolved fresh per turn rather than per session, so a summary written by a
    // colleague between two of this contact's turns is visible on the next one
    // instead of at the next restart.
    groupContext: contextForRepo(contact.repoPath),
    // Blueprint §6 stops being literally true once a writer has its own
    // checkout — its changes are on a branch nobody else has on disk. The object
    // store is still shared, so they remain readable; this is how the session
    // finds out there is anything to read.
    siblingBranches: siblingBranchesFor(contact),
    // Only when it is not the repo: a Contact working in its own repo needs no
    // explanation of where it is.
    ...(contact.worktreePath && contact.branch
      ? {
          workingContext: {
            workingPath: contact.worktreePath,
            repoPath: contact.repoPath,
            branch: contact.branch
          }
        }
      : {}),
    ...(options.usageBaseline ? { usageBaseline: options.usageBaseline } : {}),
    ...(persona.model ? { model: persona.model } : {})
  }
}

/**
 * What the *next* turn on this contact would inject, in a shape the renderer
 * can render (blueprint §5).
 *
 * Resolved in main rather than assembled in the renderer for three reasons the
 * renderer cannot work around:
 *
 * 1. `contextForRepo()` is not `groupMessages.list`. It restricts to
 *    system_summary and routine_run, splits on `durable`, and caps the two at
 *    50 and 5. The exposed list procedure returns everything, uncapped.
 * 2. `siblingBranchesFor()` stats `.git` on disk and reads a ref file. The
 *    renderer has no filesystem by design, and no procedure exposes either.
 * 3. The headings and preambles that wrap all of it are string constants in
 *    adapters/context.ts. A panel that reconstructed them from memory would be
 *    showing a plausible fiction.
 *
 * So it returns `instructions` — the literal string both adapters receive —
 * alongside the parts. Sizes are in **characters, not tokens**: nothing in this
 * process can tokenize for either backend, and a chars/4 guess sitting next to
 * a measured token count from usage_events would read as equally authoritative.
 *
 * A snapshot of what would be sent *now*, not a record of what was sent last
 * turn. The spec is resolved per turn, so this moves as colleagues work.
 */
export function contactContext(contactId: string): ContactContext | null {
  const contact = getContact(contactId)
  if (!contact) return null

  const persona = getPersonaTemplate(contact.personaTemplateId)
  if (!persona) return null

  const spec = buildSessionSpec(contact, persona)
  const instructions = composeInstructions(spec)

  return {
    persona: {
      id: persona.id,
      name: persona.name,
      backend: persona.backend,
      model: persona.model
    },
    sessionId: contact.backendSessionId,
    systemPromptChars: persona.systemPrompt.trim().length,
    // Ordered the way composeInstructions orders them, not the way the database
    // returned them — the panel claims to show what is sent, and the order is
    // part of that (it is also what keeps the prompt cacheable).
    skills: orderSkills(persona.skillIds, spec.skills).map((skill) => ({
      id: skill.id,
      name: skill.name,
      chars: skill.content.trim().length
    })),
    // Deliberately not merged into `skills` above. A Skill in this app is
    // injected prose; a repo skill is an executable capability the backend
    // discovers. Same word, different things, and this panel is the one screen
    // where both appear at once — so they stay separate fields and the UI
    // labels them apart.
    repoSkills: spec.repoSkills ?? [],
    injectedSkills: (spec.injectedSkills ?? []).map((skill) => ({
      name: skill.name,
      description: skill.description
    })),
    repoInstructions: spec.repoInstructions
      ? {
          fileName: spec.repoInstructions.fileName,
          chars: spec.repoInstructions.content.length
        }
      : null,
    mcpServers: (spec.mcpServers ?? []).map((server) => ({
      id: server.id,
      url: server.url,
      // A count, not the list: the table is 30-odd tool names and the useful
      // fact is that the narrowing happened at all. The token is never sent.
      deniedTools: server.deniedTools.length
    })),
    groupContext: (spec.groupContext ?? []).map((entry) => ({
      timestamp: entry.timestamp,
      category: entry.category,
      durable: entry.durable,
      chars: entry.content.length
    })),
    siblingBranches: (spec.siblingBranches ?? []).map((branch) => ({
      branch: branch.branch,
      contactName: branch.contactName
    })),
    workingContext: spec.workingContext ?? null,
    instructions,
    instructionsChars: instructions.length
  }
}
