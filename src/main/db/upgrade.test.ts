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
    // 0009. Both new columns read as *less* access when absent, which is the
    // only safe direction for a capability default: an upgraded profile trusts
    // nothing its repositories say and hands no persona an MCP server, exactly
    // as it behaved before the columns existed. repoTrustOf() and the `?? []`
    // in toPersonaTemplate() are where those nulls acquire that meaning.
    const capabilities = upgraded.get(
      `SELECT c.repo_trust AS trust, p.mcp_server_ids AS servers
         FROM contacts c JOIN persona_templates p ON p.id = c.persona_template_id
        WHERE c.id = 'c1'` as never
    ) as Record<string, unknown>
    expect(capabilities.trust).toBeNull()
    expect(capabilities.servers).toBeNull()

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

  /**
   * The tripwire for anything that rebuilds `messages`.
   *
   * `messages_fts` is external-content FTS5 keyed by rowid, and its sync
   * triggers belong to the messages table — so a migration that does
   * create/copy/drop/rename (which is how SQLite alters a foreign key, and how
   * drizzle-kit writes one) takes the triggers with it and renumbers the rowids
   * underneath the index. Nothing errors. Search simply stops agreeing with the
   * table, and it surfaces months later as "⌘K can't find a message I can see".
   *
   * Asserted by searching rather than by reading the schema, because the
   * failure this guards against is precisely one that leaves the schema looking
   * correct.
   */
  it('leaves message search working across a later migration', () => {
    const path = scratchDbPath()
    const before = createDb(path, migrationsThrough('0017_add_message_fts'))
    before.run(
      `INSERT INTO persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       VALUES ('p1', 'Code Reviewer', '#2a78d6', 'claude', 'Review.', '[]', 'read_only', 'read_only')` as never
    )
    before.run(
      `INSERT INTO contacts (id, persona_template_id, repo_path, display_name)
       VALUES ('c1', 'p1', '/Users/dev/my-app', 'Code Reviewer · my-app')` as never
    )
    before.run(
      `INSERT INTO messages (id, contact_id, role, content, timestamp)
       VALUES ('m1', 'c1', 'assistant', 'I cached the token read in auth.ts', 1786800000000)` as never
    )

    const upgraded = createDb(path, DRIZZLE)

    // Still found: the index survived and still points at the row.
    expect(
      upgraded.get(
        `SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH 'auth'` as never
      )
    ).toEqual({ n: 1 })

    // And the triggers survived: a row written after the upgrade indexes.
    upgraded.run(
      `INSERT INTO messages (id, contact_id, role, content, timestamp, session_id)
       VALUES ('m2', 'c1', 'user', 'what about the refresh flow', 1786800001000, 'session-abc')` as never
    )
    expect(
      upgraded.get(
        `SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH 'refresh'` as never
      )
    ).toEqual({ n: 1 })

    // Stamping a session is an UPDATE on `messages`, and 0017's update trigger
    // fires `AFTER UPDATE OF content` — so the stamp must move no index rows.
    // Were that ever widened, every stamped turn would double in search results.
    upgraded.run(`UPDATE messages SET session_id = 'session-abc' WHERE id = 'm1'` as never)
    expect(
      upgraded.get(
        `SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH 'auth'` as never
      )
    ).toEqual({ n: 1 })
  })

  it('adds session_id to existing messages as null, so no boundary is invented', () => {
    // The no-backfill decision, asserted. A profile upgrading with a year of
    // history must draw zero session dividers: the renderer reads null as
    // inheriting, so the first divider it ever draws is a real one.
    const path = scratchDbPath()
    const before = createDb(path, migrationsThrough('0017_add_message_fts'))
    before.run(
      `INSERT INTO persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       VALUES ('p1', 'Reviewer', '#2a78d6', 'claude', 'Review.', '[]', 'read_only', 'read_only')` as never
    )
    before.run(
      `INSERT INTO contacts (id, persona_template_id, repo_path, display_name, backend_session_id)
       VALUES ('c1', 'p1', '/Users/dev/my-app', 'Reviewer · my-app', 'session-live')` as never
    )
    for (const id of ['m1', 'm2', 'm3']) {
      before.run(
        `INSERT INTO messages (id, contact_id, role, content, timestamp)
         VALUES ('${id}', 'c1', 'user', 'old talk', 1786800000000)` as never
      )
    }

    const upgraded = createDb(path, DRIZZLE)

    // Specifically NOT backfilled from the contact's live resume key, which
    // would claim a year of history belongs to a session that may have started
    // this morning.
    expect(
      upgraded.get(`SELECT count(*) AS n FROM messages WHERE session_id IS NULL` as never)
    ).toEqual({ n: 3 })
  })
})

/**
 * Migration 0020's referential action, executed rather than read (review §G6).
 *
 * `usage_events.message_id` points at a table that itself cascades from
 * `contacts`, so the action on this FK decides whether a contact can be deleted
 * at all. drizzle-kit emits an ADD COLUMN with no action — its snapshot records
 * `set null` correctly, only the SQL emitter drops it — and SQLite defaults to
 * NO ACTION, under which the usage row *blocks* the cascading message delete
 * and the whole deletion throws. So the clause in the migration file is
 * hand-written, and this is what stops a regeneration quietly removing it.
 *
 * It is checked against the real `drizzle/` folder through `createDb`, which
 * sets the `foreign_keys` pragma. Without that pragma every assertion below
 * would pass for the wrong reason.
 */
describe('usage_events.message_id on delete', () => {
  function populated(): ReturnType<typeof createDb> {
    const db = createDb(scratchDbPath(), DRIZZLE)
    db.run(
      `INSERT INTO persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       VALUES ('p1', 'Reviewer', '#2a78d6', 'claude', 'Review.', '[]', 'read_only', 'read_only')` as never
    )
    db.run(
      `INSERT INTO contacts (id, persona_template_id, repo_path, display_name)
       VALUES ('c1', 'p1', '/repo', 'Reviewer · repo')` as never
    )
    db.run(
      `INSERT INTO messages (id, contact_id, role, content, timestamp)
       VALUES ('m1', 'c1', 'assistant', 'Nothing landed.', 1786800000000)` as never
    )
    db.run(
      `INSERT INTO usage_events (id, contact_id, timestamp, source, input_tokens, output_tokens, cost_usd, message_id)
       VALUES ('u1', 'c1', 1786800000000, 'message', 120, 45, 0.0031, 'm1')` as never
    )
    return db
  }

  /**
   * The failure the hand-written clause exists to prevent, and the one that
   * matters most: with NO ACTION this throws `FOREIGN KEY constraint failed`,
   * which would make `deleteContact` — and `clearAppData` with it — fail for
   * any contact that had ever run a turn.
   */
  it('lets a contact be deleted even though a usage row names its reply', () => {
    const db = populated()
    expect(() => db.run(`DELETE FROM contacts WHERE id = 'c1'` as never)).not.toThrow()
  })

  /**
   * And the spend survives it. Phase 10's rule is that spend outlives what
   * spent it, which is why `contact_id` is `set null`; a CASCADE here would
   * have deleted a month of cost history along with a tidied-up contact, and
   * the delete above would still have "passed".
   */
  it('keeps the spend, with the links nulled rather than the row removed', () => {
    const db = populated()
    db.run(`DELETE FROM contacts WHERE id = 'c1'` as never)

    const usage = db.get(
      `SELECT contact_id, message_id, cost_usd, input_tokens FROM usage_events WHERE id = 'u1'` as never
    ) as Record<string, unknown>
    expect(usage).toBeDefined()
    expect(usage.cost_usd).toBe(0.0031)
    expect(usage.input_tokens).toBe(120)
    expect(usage.contact_id).toBeNull()
    expect(usage.message_id).toBeNull()
  })

  // The narrower case, without the cascade in the way: deleting the message
  // alone must not take the spend with it either.
  it('keeps the spend when only the message is deleted', () => {
    const db = populated()
    db.run(`DELETE FROM messages WHERE id = 'm1'` as never)

    const usage = db.get(
      `SELECT contact_id, message_id FROM usage_events WHERE id = 'u1'` as never
    ) as Record<string, unknown>
    expect(usage.message_id).toBeNull()
    // Still attributed to the contact, which is still there.
    expect(usage.contact_id).toBe('c1')
  })

  // Nothing is backfilled: an upgraded profile's existing spend has no reply to
  // point at, and claiming one would put a cost under an unrelated message.
  it('adds the column to existing rows as null', () => {
    const path = scratchDbPath()
    const old = createDb(path, migrationsThrough('0019_add_contact_model'))
    old.run(
      `INSERT INTO usage_events (id, contact_id, timestamp, source, input_tokens, output_tokens, cost_usd)
       VALUES ('u-old', NULL, 1786800000000, 'message', 10, 5, 0.001)` as never
    )

    const upgraded = createDb(path, DRIZZLE)
    const usage = upgraded.get(
      `SELECT message_id, cost_usd FROM usage_events WHERE id = 'u-old'` as never
    ) as Record<string, unknown>
    expect(usage.message_id).toBeNull()
    expect(usage.cost_usd).toBe(0.001)
  })
})
