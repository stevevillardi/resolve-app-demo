import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { createDb } from './create'

/**
 * The upgrade path: an existing, populated database meeting migrations it has
 * never seen.
 *
 * `test-db.ts` builds a `:memory:` database with every migration applied at
 * once, which proves the migrations compose from nothing. It cannot prove what
 * actually ships — a profile with real rows in it, upgraded in place. That is
 * the thing that breaks, and `06-core-messaging-handoff.md` §11 item 13 carried
 * it as unverified.
 *
 * Rather than checking in a binary fixture that goes stale on the next
 * migration, this builds the "old" database from the migration files
 * themselves: apply a prefix of `drizzle/`, write rows through it, then apply
 * the whole folder over the top. Every future migration is covered by the same
 * test without anyone remembering to regenerate a fixture.
 */

const DRIZZLE = resolve('drizzle')

interface Journal {
  entries: { idx: number; tag: string }[]
}

/**
 * A copy of `drizzle/` containing only the migrations up to and including
 * `throughTag`, with a journal trimmed to match — drizzle reads the journal
 * rather than the directory listing, so the two have to agree.
 */
function migrationsThrough(throughTag: string): string {
  const journal = JSON.parse(
    readFileSync(join(DRIZZLE, 'meta', '_journal.json'), 'utf8')
  ) as Journal
  const cutoff = journal.entries.findIndex((entry) => entry.tag === throughTag)
  if (cutoff === -1) throw new Error(`no migration tagged ${throughTag}`)

  const folder = mkdtempSync(join(tmpdir(), 'drizzle-prefix-'))
  mkdirSync(join(folder, 'meta'))
  const kept = journal.entries.slice(0, cutoff + 1)
  for (const entry of kept) {
    copyFileSync(join(DRIZZLE, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: kept })
  )
  return folder
}

function scratchDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'upgrade-')), 'app.db')
}

describe('migrating a populated database', () => {
  it('carries pre-0004 personas and usage rows across every later migration', () => {
    const path = scratchDbPath()

    // The shape a Phase 3/4 profile actually had: no persona model column, no
    // usage attribution columns, no group_messages.branch, no session id.
    const old = createDb(path, migrationsThrough('0003_drop_bootstrap_check'))
    old.run(
      `INSERT INTO persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       VALUES ('p1', 'Code Reviewer', '#2a78d6', 'claude', 'Review carefully.', '["s1"]', 'read_only', 'read_only')` as never
    )
    old.run(
      `INSERT INTO contacts (id, persona_template_id, repo_path, display_name)
       VALUES ('c1', 'p1', '/Users/dev/my-app', 'Code Reviewer · my-app')` as never
    )
    old.run(
      `INSERT INTO usage_events (id, contact_id, timestamp, source, input_tokens, output_tokens, cost_usd)
       VALUES ('u1', 'c1', 1786800000000, 'message', 120, 45, 0.0031)` as never
    )

    // Same file, reopened against the full migration folder — an upgrade, not
    // a rebuild.
    const upgraded = createDb(path, DRIZZLE)

    const persona = upgraded.get(
      `SELECT id, name, model FROM persona_templates WHERE id = 'p1'` as never
    ) as { id: string; name: string; model: string | null }
    expect(persona.name).toBe('Code Reviewer')
    // Absent rather than guessed: null means "the backend's default", which is
    // what an unset column has to mean for every row that predates it.
    expect(persona.model).toBeNull()

    const usage = upgraded.get(
      `SELECT input_tokens, cost_usd, model, cost_source, session_id FROM usage_events WHERE id = 'u1'` as never
    ) as Record<string, unknown>
    expect(usage.input_tokens).toBe(120)
    expect(usage.cost_usd).toBe(0.0031)
    expect(usage.model).toBeNull()
    expect(usage.cost_source).toBeNull()
    // 0006. A pre-existing row carries no session, which is exactly why
    // baselineFor() excludes it — see services/usage-events.ts.
    expect(usage.session_id).toBeNull()

    // 0007. A contact that predates worktrees keeps working in the repo itself:
    // workingPathFor() reads `worktree_path ?? repo_path`, and isolationOf()
    // reads a null mode as `shared`. Neither is a guess — they are the only
    // answers that leave an upgraded profile behaving exactly as it did.
    const contact = upgraded.get(
      `SELECT repo_path, worktree_path, branch, isolation FROM contacts WHERE id = 'c1'` as never
    ) as Record<string, unknown>
    expect(contact.repo_path).toBe('/Users/dev/my-app')
    expect(contact.worktree_path).toBeNull()
    expect(contact.branch).toBeNull()
    expect(contact.isolation).toBeNull()

    // 0008 rebuilt the table and backfilled attribution from the contact as it
    // copied. A row written years before those columns existed still knows
    // whose spend it was and which repo it was spent on — which is the whole
    // point, since the contact is what stops being able to answer that.
    const attribution = upgraded.get(
      `SELECT contact_id, persona_template_id, repo_path FROM usage_events WHERE id = 'u1'` as never
    ) as Record<string, unknown>
    expect(attribution.contact_id).toBe('c1')
    expect(attribution.persona_template_id).toBe('p1')
    expect(attribution.repo_path).toBe('/Users/dev/my-app')
  })

  it('leaves a deleted contact’s spend behind, still attributed', () => {
    // Written from the claim rather than from the schema: deleting a Contact
    // used to cascade its usage away, so a total covering last month shrank
    // when somebody tidied up a Contact this month. Spend is a record of money
    // that was actually spent; no later bookkeeping makes that untrue.
    const path = scratchDbPath()
    const db = createDb(path, DRIZZLE)

    db.run(
      `INSERT INTO persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       VALUES ('p1', 'Code Reviewer', '#2a78d6', 'claude', 'Review carefully.', '["s1"]', 'read_only', 'read_only')` as never
    )
    db.run(
      `INSERT INTO contacts (id, persona_template_id, repo_path, display_name)
       VALUES ('c1', 'p1', '/Users/dev/my-app', 'Code Reviewer · my-app')` as never
    )
    db.run(
      `INSERT INTO usage_events (id, contact_id, persona_template_id, repo_path, timestamp, source, input_tokens, output_tokens, cost_usd)
       VALUES ('u1', 'c1', 'p1', '/Users/dev/my-app', 1786800000000, 'message', 120, 45, 0.0031)` as never
    )

    db.run(`DELETE FROM contacts WHERE id = 'c1'` as never)

    const usage = db.get(
      `SELECT contact_id, persona_template_id, repo_path, cost_usd FROM usage_events WHERE id = 'u1'` as never
    ) as Record<string, unknown>
    // The row survives its Contact...
    expect(usage).toBeDefined()
    expect(usage.cost_usd).toBe(0.0031)
    // ...with the link severed rather than the row removed...
    expect(usage.contact_id).toBeNull()
    // ...and still able to say whose spend it was and where.
    expect(usage.persona_template_id).toBe('p1')
    expect(usage.repo_path).toBe('/Users/dev/my-app')
  })

  it('still cascades the conversation away with the contact', () => {
    // The other half of the same claim: messages are conversation state and
    // *should* go. Asserting it here stops "keep the spend" quietly becoming
    // "keep everything".
    const path = scratchDbPath()
    const db = createDb(path, DRIZZLE)

    db.run(
      `INSERT INTO persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       VALUES ('p1', 'Code Reviewer', '#2a78d6', 'claude', 'Review carefully.', '["s1"]', 'read_only', 'read_only')` as never
    )
    db.run(
      `INSERT INTO contacts (id, persona_template_id, repo_path, display_name)
       VALUES ('c1', 'p1', '/Users/dev/my-app', 'Code Reviewer · my-app')` as never
    )
    db.run(
      `INSERT INTO messages (id, contact_id, role, content, timestamp)
       VALUES ('m1', 'c1', 'user', 'hello', 1786800000000)` as never
    )

    db.run(`DELETE FROM contacts WHERE id = 'c1'` as never)

    expect(db.get(`SELECT count(*) AS n FROM messages` as never)).toEqual({ n: 0 })
  })

  it('is idempotent — a second launch applies nothing and loses nothing', () => {
    const path = scratchDbPath()
    const first = createDb(path, DRIZZLE)
    first.run(
      `INSERT INTO skills (id, name, description, content) VALUES ('s1', 'Review checklist', '', 'Be thorough.')` as never
    )

    const second = createDb(path, DRIZZLE)
    const skill = second.get(`SELECT name FROM skills WHERE id = 's1'` as never) as { name: string }
    expect(skill.name).toBe('Review checklist')
  })

  it('keeps foreign keys enforced after an upgrade', () => {
    // The pragma is set per connection, not per file. An upgraded database
    // that quietly stopped enforcing references would let a contact outlive
    // the persona it points at.
    const path = scratchDbPath()
    createDb(path, migrationsThrough('0003_drop_bootstrap_check'))
    const upgraded = createDb(path, DRIZZLE)

    // Drizzle wraps SQLite's message, so the assertion is on the outcome
    // rather than the wording: the insert is refused and nothing lands.
    expect(() =>
      upgraded.run(
        `INSERT INTO contacts (id, persona_template_id, repo_path, display_name)
         VALUES ('c9', 'no-such-persona', '/tmp/x', 'Orphan')` as never
      )
    ).toThrow()
    expect(upgraded.get(`SELECT count(*) AS n FROM contacts` as never)).toEqual({ n: 0 })
  })
})
