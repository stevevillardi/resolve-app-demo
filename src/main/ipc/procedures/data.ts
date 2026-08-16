import { registerProcedure } from '../registerProcedure'
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  renameContact
} from '../../services/contacts'
import { listGroups } from '../../services/groups'
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
registerProcedure('contacts.delete', async ({ id, discardUncommitted }) => ({
  deleted: await deleteContact(id, discardUncommitted ?? false)
}))

registerProcedure('groups.list', () => listGroups())
