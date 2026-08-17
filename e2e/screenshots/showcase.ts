import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import { invoke, type LaunchedApp } from '../fixtures'

/**
 * A profile with something on every screen.
 *
 * The sweep photographs all six sections, and a section with an empty list
 * photographs its empty state twice rather than showing the thing under review.
 * So this seeds enough for every pane to have content: two repositories, three
 * Contacts across two personas and both backends, two routines (one paused), a
 * thread with replies, a repo Group with a summary in it, and spend.
 *
 * **No turn is ever started.** Rows go straight into the profile's SQLite, the
 * way e2e/usage.spec.ts already does and for the same reason: asserting on a
 * real reply would bill every run. What is under review here is presentation,
 * and presentation cannot tell where a row came from.
 *
 * Times are offsets from one captured `now` rather than literals, so the thread
 * always shows a day separator and the list always shows plausible relative
 * stamps no matter when the sweep is run.
 */

export interface Showcase {
  scratch: string
  repoA: string
  repoB: string
  contactIds: string[]
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function initRepo(path: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main', path])
  execFileSync('git', ['-C', path, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', path, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', path, 'commit', '-q', '--allow-empty', '-m', 'init'])
}

interface PersonaRow {
  id: string
  name: string
  backend: 'claude' | 'codex'
  avatarColor: string
}

interface Contact {
  id: string
  worktreePath: string | null
  branch: string | null
}

/**
 * Seeds through the real bridge where a procedure exists, and only drops to
 * SQL for the three tables no procedure writes without running a turn
 * (messages, group_messages, usage_events).
 *
 * Returns with the app **closed** — better-sqlite3 holds the file while main is
 * alive, so the direct writes have to happen after it exits. The caller
 * relaunches.
 */
export async function seedShowcase(launched: LaunchedApp, profile: string): Promise<Showcase> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-screens-')))
  const repoA = join(scratch, 'checkout-service')
  const repoB = join(scratch, 'billing-api')
  initRepo(repoA)
  initRepo(repoB)

  const window = launched.window
  await window.waitForFunction(() => 'api' in window)

  const personas = await invoke<PersonaRow[]>(window, 'personas.list')
  const claude = personas.find((persona) => persona.backend === 'claude')
  const codex = personas.find((persona) => persona.backend === 'codex')
  if (!claude || !codex) throw new Error('seed data should include both backends')

  const make = (
    personaTemplateId: string,
    repoPath: string,
    displayName: string,
    isolation?: 'shared' | 'worktree' | 'exclusive'
  ): Promise<Contact> =>
    invoke<Contact>(window, 'contacts.create', {
      personaTemplateId,
      repoPath,
      displayName,
      ...(isolation ? { isolation } : {})
    })

  // Two personas on one repo is the arrangement blueprint §16 Journey 2 is
  // about, and the only one where the Group has anything to coordinate.
  const reviewer = await make(claude.id, repoA, 'Code Reviewer · checkout-service')
  // Explicitly a worktree, so the Branches panel has something in it. Left to
  // the default this contact would be `shared` and that whole section would
  // photograph its empty state — which is not what the sweep is for.
  const refactorer = await make(codex.id, repoA, 'Refactor Buddy · checkout-service', 'worktree')
  const billing = await make(claude.id, repoB, 'Code Reviewer · billing-api')

  // The worktree itself is only materialised by the first writing turn, and no
  // turn runs here. So it is created the same way the app would, from the path
  // and branch main already derived and stored — reading them back rather than
  // recomputing keeps this honest if worktreePath() ever changes shape.
  if (refactorer.worktreePath && refactorer.branch) {
    execFileSync('git', [
      '-C',
      repoA,
      'worktree',
      'add',
      '-q',
      '-b',
      refactorer.branch,
      refactorer.worktreePath
    ])
    writeFileSync(
      join(refactorer.worktreePath, 'money.ts'),
      'export function formatMoney(cents: number, currency: string): string {\n' +
        '  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100)\n' +
        '}\n'
    )
    execFileSync('git', ['-C', refactorer.worktreePath, 'add', 'money.ts'])
    execFileSync('git', [
      '-C',
      refactorer.worktreePath,
      'commit',
      '-q',
      '-m',
      'refactor(money): one currency formatter instead of four'
    ])
  }

  await invoke(window, 'routines.create', {
    contactId: reviewer.id,
    schedule: '0 9 * * *',
    prompt: 'Review anything that landed on main overnight and summarise what changed.',
    monthlyBudgetUsd: null,
    enabled: true
  })
  await invoke(window, 'routines.create', {
    contactId: billing.id,
    schedule: '0 */4 * * *',
    prompt: 'Check the open pull requests for anything that has gone stale.',
    monthlyBudgetUsd: null,
    enabled: false
  })

  await invoke(window, 'auth.completeOnboarding')

  const groupA = await invoke<{ id: string } | null>(window, 'groups.getForRepo', {
    repoPath: repoA
  })

  await launched.app.close()

  const now = Date.now()
  const db = new DatabaseSync(join(profile, 'userData', 'switchboard.db'))
  try {
    const message = db.prepare(
      `insert into messages (id, contact_id, role, content, timestamp) values (?, ?, ?, ?, ?)`
    )
    // Spanning two days on purpose: DaySeparator only renders across a boundary,
    // and it is one of the pieces of chrome under review.
    const thread: [string, 'user' | 'assistant', string, number][] = [
      [
        'm1',
        'user',
        'Have a look at the retry logic in `checkout/session.ts` — it feels like it can double-charge.',
        now - DAY - 3 * HOUR
      ],
      [
        'm2',
        'assistant',
        'It can. `retryPayment` re-enters before the idempotency key is written, so a timeout on the first attempt leaves the second one unguarded.\n\nThe window is small but real:\n\n1. `POST /charge` times out at the gateway\n2. the key write is still in flight\n3. the retry reads no key and charges again\n\nWriting the key before the call rather than after closes it. I have not changed anything — you asked me to look.',
        now - DAY - 3 * HOUR + 40_000
      ],
      ['m3', 'user', 'Good catch. What would the fix look like?', now - 2 * HOUR],
      [
        'm4',
        'assistant',
        'Move the key write ahead of the gateway call and make it conditional:\n\n```ts\nconst claimed = await claimIdempotencyKey(key)\nif (!claimed) return existingResult(key)\nconst result = await gateway.charge(payload)\n```\n\nThat turns the retry into a read of the first attempt rather than a second charge.',
        now - 2 * HOUR + 55_000
      ]
    ]
    for (const [id, role, content, timestamp] of thread) {
      message.run(id, reviewer.id, role, content, timestamp)
    }
    message.run(
      'm5',
      refactorer.id,
      'user',
      'Pull the duplicated currency formatting into one helper.',
      now - 5 * HOUR
    )
    message.run(
      'm6',
      refactorer.id,
      'assistant',
      'Done — `formatMoney` now lives in `lib/money.ts` and the four copies call it. Kept the rounding behaviour of the checkout copy, since it was the only one with tests.',
      now - 5 * HOUR + 30_000
    )
    message.run(
      'm7',
      billing.id,
      'user',
      'Anything worth flagging in the invoice totals?',
      now - 26 * HOUR
    )

    if (groupA) {
      const groupMessage = db.prepare(
        `insert into group_messages
           (id, group_id, timestamp, type, contact_id, content, category, durable, branch)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      // A durable decision and a routine run: the two GroupMessage variants that
      // Phase 2 gave distinct shapes, so both need to be on screen.
      groupMessage.run(
        'g1',
        groupA.id,
        now - 5 * HOUR + 90_000,
        'system_summary',
        refactorer.id,
        'Consolidated four copies of currency formatting into `lib/money.ts`. Kept the checkout implementation because it was the only one under test; the other three rounded half-down and were wrong for the 0.005 case.',
        'decision',
        1,
        null
      )
      groupMessage.run(
        'g2',
        groupA.id,
        now - 90 * MINUTE,
        'routine_run',
        reviewer.id,
        'Read the overnight commits. Nothing landed on main since yesterday, so there was nothing to review.',
        'routine',
        0,
        null
      )
    }

    const usage = db.prepare(
      `insert into usage_events
         (id, contact_id, persona_template_id, repo_path, timestamp, source,
          input_tokens, output_tokens, cached_input_tokens, cost_usd, model,
          cost_source, session_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    interface Spend {
      contact: string
      persona: string
      repo: string
      source: 'message' | 'routine' | 'mention' | 'summary'
      input: number
      output: number
      cached: number | null
      cost: number | null
      model: string
      costSource: 'sdk' | 'computed'
      at: number
    }
    const spend: Spend[] = [
      {
        contact: reviewer.id,
        persona: claude.id,
        repo: repoA,
        source: 'message',
        input: 18_400,
        output: 820,
        cached: 12_000,
        cost: 0.42,
        model: 'claude-sonnet-5',
        costSource: 'sdk',
        at: now - DAY - 3 * HOUR
      },
      {
        contact: reviewer.id,
        persona: claude.id,
        repo: repoA,
        source: 'message',
        input: 24_900,
        output: 1_140,
        cached: 19_500,
        cost: 0.51,
        model: 'claude-sonnet-5',
        costSource: 'sdk',
        at: now - 2 * HOUR
      },
      {
        contact: reviewer.id,
        persona: claude.id,
        repo: repoA,
        source: 'routine',
        input: 9_100,
        output: 310,
        cached: 6_000,
        cost: 0.18,
        model: 'claude-haiku-4-5',
        costSource: 'sdk',
        at: now - 90 * MINUTE
      },
      {
        contact: refactorer.id,
        persona: codex.id,
        repo: repoA,
        source: 'message',
        input: 31_200,
        output: 2_050,
        cached: 21_000,
        cost: 0.77,
        model: 'gpt-5.5',
        costSource: 'computed',
        at: now - 5 * HOUR
      },
      {
        contact: refactorer.id,
        persona: codex.id,
        repo: repoA,
        source: 'summary',
        input: 3_400,
        output: 260,
        cached: null,
        cost: 0.04,
        model: 'gpt-5.4',
        costSource: 'computed',
        at: now - 5 * HOUR + 90_000
      },
      // No published price for this model, so costUsd is null. Present on
      // purpose: `$x.xx+` and the "N turns on a model with no published price"
      // note only render when an unpriced turn exists, and both are under review.
      {
        contact: billing.id,
        persona: claude.id,
        repo: repoB,
        source: 'message',
        input: 7_800,
        output: 640,
        cached: null,
        cost: null,
        model: 'claude-opus-5',
        costSource: 'sdk',
        at: now - 26 * HOUR
      },
      {
        contact: billing.id,
        persona: claude.id,
        repo: repoB,
        source: 'message',
        input: 11_300,
        output: 480,
        cached: 4_200,
        cost: 0.23,
        model: 'claude-sonnet-5',
        costSource: 'sdk',
        at: now - 3 * DAY
      }
    ]
    spend.forEach((row, index) => {
      usage.run(
        `spend-${index}`,
        row.contact,
        row.persona,
        row.repo,
        row.at,
        row.source,
        row.input,
        row.output,
        row.cached,
        row.cost,
        row.model,
        row.costSource,
        // One session id per contact, so a per-session reading of context size
        // has something coherent to sum or take the last of.
        `session-${row.contact}`
      )
    })
  } finally {
    db.close()
  }

  return { scratch, repoA, repoB, contactIds: [reviewer.id, refactorer.id, billing.id] }
}
