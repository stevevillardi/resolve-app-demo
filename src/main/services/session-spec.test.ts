import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
// Reaches the OS keychain otherwise. Left disconnected so no MCP server is
// offered — the capability assertions below are about repo content.
vi.mock('./github-auth', () => ({
  getGitHubStatus: () => ({ connected: false, configured: true }),
  getGitHubToken: () => null
}))

const { buildSessionSpec, contactContext, repoOffers } = await import('./session-spec')
const { setRepoTrust } = await import('./contacts')
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

  // A persona is reusable across repositories and a model choice often is not,
  // so the Contact's own wins — and null on the Contact means
  // "follow the persona", which is the default and the common case.
  it('lets the contact override its persona model', () => {
    const persona = { ...getPersonaTemplate(PERSONA_ID)!, model: 'claude-sonnet-5' }
    const contact = getContact(CONTACT_ID)!

    expect(buildSessionSpec(contact, persona).model).toBe('claude-sonnet-5')
    expect(buildSessionSpec({ ...contact, model: 'claude-opus-5' }, persona).model).toBe(
      'claude-opus-5'
    )
  })

  it('lets a contact set a model where its persona has none', () => {
    const persona = getPersonaTemplate(PERSONA_ID)!
    const contact = { ...getContact(CONTACT_ID)!, model: 'claude-haiku-4-5' }

    expect(buildSessionSpec(contact, persona).model).toBe('claude-haiku-4-5')
  })
})

/**
 * Capability resolution belongs here rather than in startTurn, and this is the
 * assertion that keeps it here.
 *
 * Resolved in startTurn instead, a turn would send the repository's
 * instructions and its skills while this panel — the screen whose entire job is
 * "what will this turn send" — did not know they existed. Nothing fails in that
 * arrangement; the panel simply under-reports. `capabilitiesFor` living inside
 * buildSessionSpec is what makes the two provably the same, so the test uses a
 * *real* repository on disk with content in it: asserting the fields are merely
 * defined would still pass against empty arrays.
 */
describe('buildSessionSpec resolves what the repository contributes', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'session-spec-'))

  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  function trustedContact(trust: { instructions: boolean; skills: string[] }): void {
    writeFileSync(join(scratch, 'AGENTS.md'), 'Run the linter before you commit.')
    mkdirSync(join(scratch, '.claude/skills/release-notes'), { recursive: true })
    writeFileSync(
      join(scratch, '.claude/skills/release-notes/SKILL.md'),
      '---\nname: release-notes\ndescription: Draft the release notes.\n---\nBody.'
    )
    db.update(contacts).set({ repoPath: scratch, repoTrust: trust }).run()
  }

  it('sends nothing from the repo until the contact is opted in', () => {
    trustedContact({ instructions: false, skills: [] })
    const spec = buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)

    expect(spec.repoInstructions).toBeUndefined()
    expect(spec.repoSkills).toEqual([])
    expect(spec.injectedSkills).toEqual([])
  })

  it('carries the repo instructions and skills once it is', () => {
    trustedContact({ instructions: true, skills: ['release-notes'] })
    const spec = buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)

    expect(spec.repoInstructions?.fileName).toBe('AGENTS.md')
    expect(spec.repoInstructions?.content).toContain('Run the linter')
    // Claude cannot discover its own skills under `settingSources: []`, so an
    // approved one arrives described rather than named.
    expect(spec.injectedSkills?.map((skill) => skill.name)).toEqual(['release-notes'])
  })

  it('reports to the panel exactly what it hands the turn', () => {
    trustedContact({ instructions: true, skills: ['release-notes'] })
    const spec = buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)
    const shown = contactContext(CONTACT_ID)!

    expect(shown.repoInstructions).toEqual({
      fileName: spec.repoInstructions!.fileName,
      chars: spec.repoInstructions!.content.length
    })
    expect(shown.injectedSkills.map((skill) => skill.name)).toEqual(
      spec.injectedSkills!.map((skill) => skill.name)
    )
    expect(shown.repoSkills).toEqual(spec.repoSkills)
  })
})

/**
 * The difference between an empty answer and no answer.
 *
 * GitHub is mocked disconnected at the top of this file, so granting the server
 * to the persona is enough to produce the case this is about: something a human
 * deliberately turned on that the session genuinely cannot reach.
 */
describe('a capability granted and not reachable', () => {
  function grantGithub(): void {
    db.update(personaTemplates)
      .set({ mcpServerIds: ['github'] })
      .run()
  }

  it('offers no server, and says why, rather than staying silent', () => {
    grantGithub()
    const spec = buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)

    expect(spec.mcpServers).toEqual([])
    expect(spec.unavailableServers).toEqual([
      { id: 'github', reason: expect.stringContaining('not connected') }
    ])
  })

  it('puts the reason in the prompt the session actually receives', () => {
    // The assertion that matters. A field on the spec that no adapter renders
    // leaves the persona exactly as unable to tell the two cases apart as it
    // would be with no field at all, which is how a gap like this survives
    // being plumbed: every half is present and nothing renders the result.
    grantGithub()
    const composed = composeInstructions(
      buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)
    )

    expect(composed).toContain('Not available this turn')
    expect(composed).toContain('Do not report an empty result')
  })

  it('says nothing when the persona was never granted the server', () => {
    // Silence is correct here: nothing was promised, so nothing is missing.
    const spec = buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)
    expect(spec.unavailableServers).toEqual([])
    expect(composeInstructions(spec)).not.toContain('Not available this turn')
  })

  it('tells the panel the same thing it tells the session', () => {
    grantGithub()
    const shown = contactContext(CONTACT_ID)!

    expect(shown.mcpServers).toEqual([])
    expect(shown.unavailableServers).toEqual(
      buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!).unavailableServers
    )
  })
})

/**
 * The write path, end to end.
 *
 * Everything above sets `repoTrust` by writing the column directly, which
 * proves capabilitiesFor reads it but not that anything in the app can change
 * it. `setRepoTrust` is that writer — the only way the switch governing
 * whether a repository may instruct a persona is reachable from the UI — and a
 * switch nothing can throw governs nothing. These assertions cover it end to
 * end: grant, revoke, and the limits of what a grant covers.
 */
describe('granting trust changes what the next turn sends', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'trust-write-'))

  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  function repoWithContent(): void {
    writeFileSync(join(scratch, 'CLAUDE.md'), 'Always run the linter.')
    mkdirSync(join(scratch, '.claude/skills/release-notes'), { recursive: true })
    writeFileSync(
      join(scratch, '.claude/skills/release-notes/SKILL.md'),
      '---\nname: release-notes\ndescription: Draft the release notes.\n---\nBody.'
    )
    db.update(contacts).set({ repoPath: scratch, repoTrust: null }).run()
  }

  it('sends nothing from a repository nobody has opted into', () => {
    repoWithContent()
    const composed = composeInstructions(
      buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)
    )

    expect(composed).not.toContain('Always run the linter.')
    expect(composed).not.toContain('release-notes')
  })

  it('sends both once setRepoTrust has been called', () => {
    repoWithContent()
    setRepoTrust(CONTACT_ID, { instructions: true, skills: ['release-notes'] })

    const composed = composeInstructions(
      buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)
    )

    expect(composed).toContain('Always run the linter.')
    expect(composed).toContain('release-notes')
  })

  it('stops sending them again when trust is revoked', () => {
    // Revocation has to be as real as the grant, or "turn it off" is a lie the
    // UI tells. Resolved per turn, so this takes effect on the next message.
    repoWithContent()
    setRepoTrust(CONTACT_ID, { instructions: true, skills: ['release-notes'] })
    setRepoTrust(CONTACT_ID, { instructions: false, skills: [] })

    const composed = composeInstructions(
      buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)
    )

    expect(composed).not.toContain('Always run the linter.')
    expect(composed).not.toContain('release-notes')
  })

  it('does not extend an approval to a skill committed afterwards', () => {
    // The reason repoTrust.skills is an allowlist of names and not a boolean.
    // A human approved what was in the repository when they looked at it.
    repoWithContent()
    setRepoTrust(CONTACT_ID, { instructions: false, skills: ['release-notes'] })

    mkdirSync(join(scratch, '.claude/skills/deploy-prod'), { recursive: true })
    writeFileSync(
      join(scratch, '.claude/skills/deploy-prod/SKILL.md'),
      '---\nname: deploy-prod\ndescription: Ship it.\n---\nBody.'
    )

    const spec = buildSessionSpec(getContact(CONTACT_ID)!, getPersonaTemplate(PERSONA_ID)!)
    const names = (spec.injectedSkills ?? []).map((skill) => skill.name)

    expect(names).toContain('release-notes')
    expect(names).not.toContain('deploy-prod')
  })

  it('offers what is on disk regardless of what has been approved', () => {
    // You cannot approve a skill nothing told you exists, so the offer list is
    // deliberately not gated on the choice already made.
    repoWithContent()
    const offers = repoOffers(CONTACT_ID)!

    expect(offers.instructionsFile).toBe('CLAUDE.md')
    expect(offers.skills.map((skill) => skill.name)).toContain('release-notes')
    // Claude cannot discover a .claude/skills entry under settingSources: [],
    // so approving it means the app describes it rather than the backend
    // finding it.
    expect(offers.skills.find((skill) => skill.name === 'release-notes')?.codexNative).toBe(false)
  })

  it('returns no offers for a contact that does not exist', () => {
    expect(repoOffers('nope')).toBeNull()
  })
})
