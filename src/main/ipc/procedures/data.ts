import { registerProcedure } from '../registerProcedure'
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  markContactRead,
  rebindContactPersona,
  setContactIsolation,
  startFreshSession,
  renameContact,
  setRepoTrust
} from '../../services/contacts'
import { emitMessagesChanged } from '../../services/agent-events'
import { contactFiles } from '../../services/contact-files'
import { unreadCounts } from '../../services/unread'
import { contactContext, repoOffers } from '../../services/session-spec'
import { listGroups, markGroupRead } from '../../services/groups'
import {
  createPersonaTemplate,
  deletePersonaTemplate,
  getPersonaTemplate,
  listPersonaTemplates,
  updatePersonaTemplate
} from '../../services/persona-templates'
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from '../../services/skills'

/**
 * Phase 4 CRUD. Every handler is a one-liner over a service — the interesting
 * behaviour (delete rules, group auto-creation, id minting) lives in
 * src/main/services/, and validation is already handled by registerProcedure
 * against the schemas in src/shared/domain.ts.
 */

registerProcedure('skills.list', () => listSkills())
registerProcedure('skills.get', ({ id }) => getSkill(id))
registerProcedure('skills.create', (draft) => createSkill(draft))
registerProcedure('skills.update', (skill) => updateSkill(skill))
registerProcedure('skills.delete', ({ id }) => {
  deleteSkill(id)
  return { deleted: true }
})

registerProcedure('personas.list', () => listPersonaTemplates())
registerProcedure('personas.get', ({ id }) => getPersonaTemplate(id))
registerProcedure('personas.create', (draft) => createPersonaTemplate(draft))
registerProcedure('personas.update', (persona) => updatePersonaTemplate(persona))
// Throws with a message naming the bound contacts; the renderer surfaces it.
registerProcedure('personas.delete', ({ id }) => {
  deletePersonaTemplate(id)
  return { deleted: true }
})

registerProcedure('contacts.list', () => listContacts())
registerProcedure('contacts.get', ({ id }) => getContact(id))
registerProcedure('contacts.create', (draft) => createContact(draft))
registerProcedure('contacts.update', ({ id, displayName }) => renameContact(id, displayName))
registerProcedure('contacts.rebindPersona', ({ id, personaTemplateId }) =>
  rebindContactPersona(id, personaTemplateId)
)
registerProcedure('contacts.startFreshSession', ({ id }) => startFreshSession(id))
registerProcedure('contacts.setIsolation', ({ id, isolation, discardUncommitted }) =>
  setContactIsolation(id, isolation, discardUncommitted ?? false)
)
registerProcedure('contacts.context', ({ contactId }) => contactContext(contactId))
// The only writer of repo_trust, and so the only way a repository's own
// instructions or skills ever reach a persona.
registerProcedure('contacts.setRepoTrust', ({ id, trust }) => setRepoTrust(id, trust))
registerProcedure('contacts.repoOffers', ({ contactId }) => repoOffers(contactId))
registerProcedure('contacts.files', ({ contactId }) => contactFiles(contactId))
registerProcedure('contacts.delete', async ({ id, discardUncommitted }) => ({
  deleted: await deleteContact(id, discardUncommitted ?? false)
}))

registerProcedure('groups.list', () => listGroups())

registerProcedure('unread.counts', () => unreadCounts())
// Marking read announces on the same channel a new message does: one signal
// drives the sidebar badges, the previews, and the dock. totalUnread() is not
// exposed over IPC — the dock badge consumes it in main directly.
registerProcedure('contacts.markRead', ({ id }) => {
  const contact = markContactRead(id)
  emitMessagesChanged()
  return contact
})
registerProcedure('groups.markRead', ({ id }) => {
  const group = markGroupRead(id)
  emitMessagesChanged()
  return group
})
