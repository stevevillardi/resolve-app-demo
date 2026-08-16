import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, groups, personaTemplates, usageEvents } from '../db/schema'
import type { AppDatabase } from '../db'
import type { AgentCapabilities } from '../../shared/agent'
import type { StructuredResult } from '../adapters/types'

/**
 * Against a real :memory: SQLite, with only the adapter mocked — the point of
 * this module is what it writes, and a mocked database would let the group_id
 * foreign key and the durable flag go untested.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

let summarizeResult: StructuredResult = { data: null, usage: null }
let lastSummarizeCall: { prompt: string; schema: Record<string, unknown> } | null = null
let lastSpec: Record<string, unknown> | null = null
let capabilities: AgentCapabilities = {
  streamsTextDeltas: true,
  streamsToolProgress: true,
  costSource: 'sdk',
  sandboxEnforcement: 'os',
  supportsStructuredOutput: true
}

vi.mock('./adapter-host', () => ({
  adapterForBackend: () => ({
    backend: 'claude',
    get capabilities() {
      return capabilities
    },
    createSession: (spec: Record<string, unknown>) => {
      lastSpec = spec
      return { backend: 'claude', spec, sessionId: null }
    },
    resume: (spec: Record<string, unknown>) => ({ backend: 'claude', spec, sessionId: null }),
    // Never called — compaction uses summarize(), not run(). Present so the
    // fake still satisfies the AgentAdapter shape.
    run: (): AsyncGenerator<never> => {
      throw new Error('compaction must not call run()')
    },
    summarize: async (
      _session: unknown,
      prompt: string,
      schema: Record<string, unknown>
    ): Promise<StructuredResult> => {
      lastSummarizeCall = { prompt, schema }
      return summarizeResult
    }
  })
}))

const { summarizeTurn } = await import('./compaction')
const { listGroupMessages } = await import('./group-messages')

const REPO = '/Users/dev/my-app'
const GROUP = 'group-1'

function seed(): void {
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Refactor Buddy',
      avatarColor: '#000',
      backend: 'claude',
      systemPrompt: 'You refactor code.',
      skillIds: ['skill-1'],
      sandbox: 'workspace_write',
      githubScope: 'read_only',
      model: 'claude-opus-5'
    })
    .run()
  db.insert(contacts)
    .values({
      id: 'contact-1',
      personaTemplateId: 'persona-1',
      repoPath: REPO,
      displayName: 'Refactor Buddy',
      backendSessionId: null
    })
    .run()
  db.insert(groups).values({ id: GROUP, repoPath: REPO }).run()
}

const GOOD: StructuredResult = {
  data: { summary: 'Cached the token read.', category: 'decision' },
  usage: {
    inputTokens: 900,
    outputTokens: 40,
    cachedInputTokens: 0,
    costUsd: 0.0004,
    costSource: 'sdk',
    model: 'claude-haiku-4-5-20251001'
  }
}

beforeEach(() => {
  db = createTestDb()
  seed()
  summarizeResult = { data: null, usage: null }
  lastSummarizeCall = null
  lastSpec = null
  capabilities = { ...capabilities, supportsStructuredOutput: true }
})

describe('summarizeTurn', () => {
  it('writes a durable system_summary for a decision', () => {
    summarizeResult = GOOD
    return summarizeTurn('contact-1', 'refactor auth', 'I cached it.').then(() => {
      const [written] = listGroupMessages(GROUP)
      expect(written).toMatchObject({
        type: 'system_summary',
        contactId: 'contact-1',
        content: 'Cached the token read.',
        category: 'decision',
        durable: true
      })
    })
  })

  /**
   * A routine's summary IS its Group record: it replaces the system_summary
   * rather than joining it, so one unattended fire leaves one row rather than
   * two saying much the same thing. It still carries category/durable, because
   * contextForRepo reads both types — work done while nobody was watching is
   * exactly what §6 has to carry across Contact boundaries.
   */
  it('files a routine turn as routine_run instead, keeping its category', async () => {
    summarizeResult = GOOD

    await summarizeTurn('contact-1', 'sweep lint', 'I cached it.', {
      kind: 'routine',
      routineId: 'routine-1'
    })

    expect(listGroupMessages(GROUP)[0]).toMatchObject({
      type: 'routine_run',
      contactId: 'contact-1',
      content: 'Cached the token read.',
      category: 'decision',
      durable: true
    })
  })

  it('returns the summary it wrote, so a routine has a sentence for its history', async () => {
    summarizeResult = GOOD

    const result = await summarizeTurn('contact-1', 'q', 'a', {
      kind: 'routine',
      routineId: 'routine-1'
    })

    expect(result).toMatchObject({
      summary: 'Cached the token read.',
      category: 'decision',
      durable: true
    })
  })

  it('marks a tradeoff durable too', async () => {
    summarizeResult = {
      ...GOOD,
      data: { summary: 'Chose mtime over a timer.', category: 'tradeoff' }
    }
    await summarizeTurn('contact-1', 'q', 'a')
    expect(listGroupMessages(GROUP)[0].durable).toBe(true)
  })

  it('marks routine work non-durable', async () => {
    // §6's rule, and the only place it is decided.
    summarizeResult = { ...GOOD, data: { summary: 'Read some files.', category: 'routine' } }
    await summarizeTurn('contact-1', 'q', 'a')
    expect(listGroupMessages(GROUP)[0].durable).toBe(false)
  })

  it('persists a reported branch', async () => {
    summarizeResult = {
      ...GOOD,
      data: { summary: 'Landed the rename.', category: 'decision', branch: 'persona/refactor' }
    }
    await summarizeTurn('contact-1', 'q', 'a')
    expect(listGroupMessages(GROUP)[0].branch).toBe('persona/refactor')
  })

  it('records the spend as its own usage source', async () => {
    // A summary turn is spend the user never asked for directly; folding it
    // into `message` would hide the cost of coordination on the dashboard.
    summarizeResult = GOOD
    await summarizeTurn('contact-1', 'q', 'a')

    const [event] = db.select().from(usageEvents).all()
    expect(event.source).toBe('summary')
    expect(event.model).toBe('claude-haiku-4-5-20251001')
  })

  it('summarises on the cheap model, not the persona model', async () => {
    summarizeResult = GOOD
    await summarizeTurn('contact-1', 'q', 'a')
    expect(lastSpec?.model).toBe('claude-haiku-4-5-20251001')
    expect(lastSpec?.model).not.toBe('claude-opus-5')
  })

  it('gives the summariser no skills and no write access', async () => {
    // It is handed its material in the prompt. Inheriting the persona's skills
    // would spend tokens re-injecting instructions irrelevant to summarising.
    summarizeResult = GOOD
    await summarizeTurn('contact-1', 'q', 'a')
    const persona = lastSpec?.persona as Record<string, unknown>
    expect(persona.skillIds).toEqual([])
    expect(persona.sandbox).toBe('read_only')
    expect(lastSpec?.skills).toEqual([])
  })

  it('sends both halves of the exchange', async () => {
    summarizeResult = GOOD
    await summarizeTurn('contact-1', 'why is auth slow?', 'It re-read the token file.')
    expect(lastSummarizeCall?.prompt).toContain('why is auth slow?')
    expect(lastSummarizeCall?.prompt).toContain('It re-read the token file.')
  })

  it('asks for the branch field, so worktrees need no schema change later', async () => {
    summarizeResult = GOOD
    await summarizeTurn('contact-1', 'q', 'a')
    const properties = lastSummarizeCall?.schema.properties as Record<string, unknown>
    expect(Object.keys(properties)).toContain('branch')
    // Every property is in `required` because Codex runs this through OpenAI's
    // strict mode, which rejects a schema whose `required` omits any of them —
    // see the schema tests in adapters/codex.test.ts. Absence is expressed as a
    // nullable type instead.
    expect(lastSummarizeCall?.schema.required).toEqual(['summary', 'category', 'branch', 'needs'])
  })

  // Strict mode applies to sub-objects too. Getting this wrong rejects *every*
  // summary, not merely the rare turn that fills `needs` in — so it is worth an
  // assertion rather than a live discovery.
  it('gives the nested needs object its own required list and closed shape', async () => {
    summarizeResult = GOOD
    await summarizeTurn('contact-1', 'q', 'a')
    const properties = lastSummarizeCall?.schema.properties as Record<
      string,
      { required?: string[]; additionalProperties?: boolean }
    >

    expect(properties.needs.required).toEqual(['branch', 'reason'])
    expect(properties.needs.additionalProperties).toBe(false)
  })
})

describe('branch requests', () => {
  function needing(needs: { branch: string; reason: string } | null): void {
    summarizeResult = { ...GOOD, data: { ...(GOOD.data as object), needs } }
  }

  it('writes nothing extra when the turn was not blocked', async () => {
    needing(null)
    await summarizeTurn('contact-1', 'q', 'a')

    expect(listGroupMessages(GROUP).map((m) => m.type)).toEqual(['system_summary'])
  })

  // A separate row rather than a field on the summary: it is the one step of
  // the phase a human has to take, so it needs a shape of its own in the thread.
  it('records a request as its own row alongside the summary', async () => {
    needing({ branch: 'persona/refactor-buddy-a3f9', reason: 'Needs the new auth helper.' })
    await summarizeTurn('contact-1', 'q', 'a')

    const rows = listGroupMessages(GROUP)
    expect(rows.map((m) => m.type)).toEqual(['system_summary', 'branch_request'])
    expect(rows[1]).toMatchObject({
      branch: 'persona/refactor-buddy-a3f9',
      content: 'Needs the new auth helper.',
      contactId: 'contact-1'
    })
  })

  // Asking for a merge of its own branch is a request to merge work into the
  // tree it is already in, which is a model mistake rather than an instruction.
  it('ignores a request for the branch the session is already on', async () => {
    db.update(contacts).set({ branch: 'persona/mine' }).run()
    needing({ branch: 'persona/mine', reason: 'I need my own work.' })
    await summarizeTurn('contact-1', 'q', 'a')

    expect(listGroupMessages(GROUP).map((m) => m.type)).toEqual(['system_summary'])
  })
})

describe('summarizeTurn degrades rather than failing', () => {
  it('writes nothing when the backend produced no conforming answer', async () => {
    summarizeResult = { data: null, usage: null }
    await expect(summarizeTurn('contact-1', 'q', 'a')).resolves.toBeNull()
    expect(listGroupMessages(GROUP)).toEqual([])
  })

  it('writes nothing when the answer parses but is the wrong shape', async () => {
    // The backend is only asked to follow a schema, not guaranteed to. Zod is
    // the last line before a malformed row reaches the Group.
    summarizeResult = { ...GOOD, data: { summary: 'ok', category: 'unrecognised' } }
    await expect(summarizeTurn('contact-1', 'q', 'a')).resolves.toBeNull()
    expect(listGroupMessages(GROUP)).toEqual([])
  })

  it('still records usage for an unusable summary', async () => {
    // The tokens were spent either way, and spend that silently vanishes is
    // worse on a cost dashboard than spend with nothing to show for it.
    summarizeResult = { data: { nonsense: true }, usage: GOOD.usage }
    await summarizeTurn('contact-1', 'q', 'a')
    expect(db.select().from(usageEvents).all()).toHaveLength(1)
  })

  it('does nothing for a turn that produced no reply', async () => {
    // An aborted turn reaches finish() with empty text. Summarising nothing
    // would spend money to write "the assistant said nothing".
    await expect(summarizeTurn('contact-1', 'q', '   ')).resolves.toBeNull()
    expect(lastSummarizeCall).toBeNull()
  })

  it('does nothing when the backend cannot constrain output to a schema', async () => {
    capabilities = { ...capabilities, supportsStructuredOutput: false }
    summarizeResult = GOOD
    await expect(summarizeTurn('contact-1', 'q', 'a')).resolves.toBeNull()
    expect(lastSummarizeCall).toBeNull()
  })

  it('does nothing for a repo with no group', async () => {
    db.update(contacts).set({ repoPath: '/unbound' }).run()
    summarizeResult = GOOD
    await expect(summarizeTurn('contact-1', 'q', 'a')).resolves.toBeNull()
  })

  it('never rejects, however the summariser fails', async () => {
    // The contract the caller relies on: finish() fires this without awaiting
    // it, so a rejection would surface as an unhandled promise rejection on a
    // turn that already succeeded.
    const boom = new Error('backend exploded')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    summarizeResult = {
      get data(): never {
        throw boom
      },
      usage: null
    }
    await expect(summarizeTurn('contact-1', 'q', 'a')).resolves.toBeNull()
  })

  it('ignores a contact that has since been deleted', async () => {
    summarizeResult = GOOD
    await expect(summarizeTurn('contact-gone', 'q', 'a')).resolves.toBeNull()
  })
})
