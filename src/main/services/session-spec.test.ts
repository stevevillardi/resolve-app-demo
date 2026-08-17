import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, groupMessages, groups, personaTemplates, skills } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * The claim under test is not "contactContext returns some fields" — it is that
 * what the panel shows is what a turn actually sends.
 *
 * Two ways that can quietly stop being true, and both are asserted here: the
 * group log the panel reports is `contextForRepo`'s filtered, capped set rather
 * than every row in the table, and the skills are in `persona.skillIds` order
 * rather than whatever order the database handed back.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({
  app: { getPath: () => '/Users/dev/Library/Application Support/persona-router' }
}))

const { buildSessionSpec, contactContext } = await import('./session-spec')
const { composeInstructions } = await import('../adapters/context')
const { getContact } = await import('./contacts')
const { getPersonaTemplate } = await import('./persona-templates')

const PERSONA_ID = 'persona-1'
const CONTACT_ID = 'contact-1'
const REPO = '~/code/app'

beforeEach(() => {
  db = createTestDb()

  db.insert(skills)
    .values([
      { id: 'skill-a', name: 'Alpha', description: 'a', content: '  Alpha instructions.  ' },
      { id: 'skill-b', name: 'Bravo', description: 'b', content: 'Bravo instructions.' }
    ])
    .run()

  db.insert(personaTemplates)
    .values({
      id: PERSONA_ID,
      name: 'Code Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: '  You are a meticulous reviewer.  ',
      // Deliberately the reverse of insertion order, which is what makes the
      // ordering assertion below mean something.
      skillIds: ['skill-b', 'skill-a'],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()

  db.insert(groups).values({ id: 'group-1', repoPath: REPO }).run()
  db.insert(contacts)
    .values({
      id: CONTACT_ID,
      personaTemplateId: PERSONA_ID,
      repoPath: REPO,
      displayName: 'Reviewer · app',
      backendSessionId: null,
      worktreePath: null,
      branch: null,
      isolation: 'shared'
    })
    .run()
})

function addGroupMessage(
  id: string,
  type: 'system_summary' | 'routine_run' | 'agent_reply' | 'user_mention',
  content: string
): void {
  db.insert(groupMessages)
    .values({
      id,
      groupId: 'group-1',
      timestamp: new Date(Date.parse('2026-08-16T12:00:00Z')),
      type,
      contactId: CONTACT_ID,
      content,
      ...(type === 'system_summary' ? { category: 'decision', durable: true } : {})
    })
    .run()
}

describe('contactContext', () => {
  it('returns null for a contact that does not exist', () => {
    expect(contactContext('nope')).toBeNull()
  })

  it('reports the instructions a turn would actually compose', () => {
    // The one assertion that keeps the panel honest: it must be the same string
    // the adapters receive, not a reconstruction of it.
    const contact = getContact(CONTACT_ID)!
    const persona = getPersonaTemplate(PERSONA_ID)!
    const expected = composeInstructions(buildSessionSpec(contact, persona))

    expect(contactContext(CONTACT_ID)?.instructions).toBe(expected)
  })

  it('includes the system prompt and every attached skill in that string', () => {
    const report = contactContext(CONTACT_ID)!
    expect(report.instructions).toContain('You are a meticulous reviewer.')
    expect(report.instructions).toContain('Alpha instructions.')
    expect(report.instructions).toContain('Bravo instructions.')
  })

  it('lists skills in persona.skillIds order, not database order', () => {
    // composeInstructions orders by skillIds so the prompt prefix stays stable
    // and cacheable. A panel that listed them in another order would be
    // describing a prompt that is not sent.
    expect(contactContext(CONTACT_ID)?.skills.map((skill) => skill.name)).toEqual([
      'Bravo',
      'Alpha'
    ])
  })

  it('counts trimmed characters, matching what is injected', () => {
    const report = contactContext(CONTACT_ID)!
    // '  Alpha instructions.  ' is 23 raw, 19 trimmed — and 19 is what lands in
    // the prompt, so 19 is what the panel must say.
    expect(report.skills.find((skill) => skill.name === 'Alpha')?.chars).toBe(19)
    expect(report.systemPromptChars).toBe('You are a meticulous reviewer.'.length)
  })

  it('reports the filtered repo log, not every group row', () => {
    // contextForRepo takes system_summary and routine_run only. groupMessages
    // .list returns all four types, so a renderer-side copy built on that would
    // over-report the context by everything anyone ever said in the thread.
    addGroupMessage('g-summary', 'system_summary', 'A decision was made.')
    addGroupMessage('g-reply', 'agent_reply', 'chatter')
    addGroupMessage('g-mention', 'user_mention', 'more chatter')

    const report = contactContext(CONTACT_ID)!
    expect(report.groupContext).toHaveLength(1)
    expect(report.groupContext[0].chars).toBe('A decision was made.'.length)
    expect(report.instructions).toContain('A decision was made.')
    expect(report.instructions).not.toContain('chatter')
  })

  it('says instructionsChars is the length of the string it returns', () => {
    const report = contactContext(CONTACT_ID)!
    expect(report.instructionsChars).toBe(report.instructions.length)
  })

  it('has no working context for a contact that works in the repo itself', () => {
    expect(contactContext(CONTACT_ID)?.workingContext).toBeNull()
  })
})

describe('buildSessionSpec', () => {
  it('never sets writablePaths, because materialising a worktree is a side effect', () => {
    // The panel calls this. Asking what a turn *would* send must not create a
    // checkout on disk — startTurn adds writablePaths afterwards, from
    // ensureWorktree().
    const contact = getContact(CONTACT_ID)!
    const persona = getPersonaTemplate(PERSONA_ID)!
    expect(buildSessionSpec(contact, persona).writablePaths).toBeUndefined()
  })

  it('carries the persona model only when one is set', () => {
    const contact = getContact(CONTACT_ID)!
    const persona = getPersonaTemplate(PERSONA_ID)!
    expect(buildSessionSpec(contact, persona).model).toBeUndefined()

    expect(buildSessionSpec(contact, { ...persona, model: 'claude-opus-5' }).model).toBe(
      'claude-opus-5'
    )
  })
})
