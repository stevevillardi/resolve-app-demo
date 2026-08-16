import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, test, type Locator } from '@playwright/test'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  waitForShell,
  type LaunchedApp
} from './fixtures'

/**
 * The usage dashboard against real `usage_events` rows.
 *
 * No turn is started here — no spec in this suite starts one, because asserting
 * on a real reply would bill every E2E run. The rows are written straight into
 * the profile's SQLite instead, which is honest for what is under test: the
 * *reading* half. Whether a turn writes a correct row is settled by
 * `usage-events.test.ts` and by the hand-checked Codex arithmetic in the phase
 * doc; what nothing else covers is whether the renderer then adds them up and
 * says so truthfully.
 *
 * The seeded set is deliberately awkward, because the easy cases were never the
 * risk: two backends, two repos, two models on one contact, a turn with no
 * price at all, and a row written before the `model` column existed.
 */

test.describe.configure({ timeout: 180_000 })

let profile: string
let launched: LaunchedApp
let scratch: string
let repoA: string
let repoB: string
let claudePersonaName: string
let codexPersonaName: string

/**
 * The headline figure, scoped to its tile.
 *
 * Not a window-wide text match: the scope list always shows the *all personas*
 * total beside "All personas", so a bare `getByText('$4.00+')` keeps passing
 * after a filter has been applied — it is reading the sidebar, not the answer.
 */
function reportedSpend(): Locator {
  return launched.window.getByText('Reported spend').locator('..')
}

/** The source filter, addressed by its group so its labels can't collide. */
function sourceFilter(): Locator {
  return launched.window.getByRole('radiogroup', { name: 'Usage source' })
}

/** Local midnight `daysAgo` days back — the same boundary the dashboard buckets on. */
function daysAgo(days: number): number {
  const day = new Date()
  day.setHours(12, 0, 0, 0)
  day.setDate(day.getDate() - days)
  return day.getTime()
}

interface SeedRow {
  contactId: string
  source: 'message' | 'routine' | 'mention' | 'summary'
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  model: string | null
  costSource: 'sdk' | 'computed' | null
  timestamp: number
}

/**
 * Writes usage rows directly. Opened writable, unlike fixtures.ts's read-only
 * `readProfileDb` — and kept local to this spec rather than added there, since
 * seeding rows behind the app's back is exactly the kind of thing that should
 * not become a general-purpose convenience.
 *
 * Safe because the app is closed at this point: better-sqlite3 holds the file
 * while main is alive.
 */
function seedUsage(rows: SeedRow[]): void {
  const db = new DatabaseSync(join(profile, 'userData', 'persona-router.db'))
  try {
    const insert = db.prepare(
      `insert into usage_events
         (id, contact_id, timestamp, source, input_tokens, output_tokens,
          cost_usd, model, cost_source)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    rows.forEach((row, index) => {
      insert.run(
        `seed-${index}`,
        row.contactId,
        row.timestamp,
        row.source,
        row.inputTokens,
        row.outputTokens,
        row.costUsd,
        row.model,
        row.costSource
      )
    })
  } finally {
    db.close()
  }
}

function initRepo(path: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main', path])
  execFileSync('git', ['-C', path, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', path, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', path, 'commit', '-q', '--allow-empty', '-m', 'init'])
}

test.beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-e2e-usage-')))
  repoA = join(scratch, 'alpha')
  repoB = join(scratch, 'beta')
  initRepo(repoA)
  initRepo(repoB)

  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)

  const personas = await invoke<{ id: string; name: string; backend: string; sandbox: string }[]>(
    launched.window,
    'personas.list'
  )
  const claude = personas.find((persona) => persona.backend === 'claude')
  const codex = personas.find((persona) => persona.backend === 'codex')
  expect(claude, 'seed data should include a Claude persona').toBeTruthy()
  expect(codex, 'seed data should include a Codex persona').toBeTruthy()
  claudePersonaName = claude!.name
  codexPersonaName = codex!.name

  const make = (
    personaTemplateId: string,
    repoPath: string,
    displayName: string
  ): Promise<{ id: string }> =>
    invoke<{ id: string }>(launched.window, 'contacts.create', {
      personaTemplateId,
      repoPath,
      displayName
    })

  const claudeContact = await make(claude!.id, repoA, 'Reviewer · alpha')
  const codexContact = await make(codex!.id, repoA, 'Refactorer · alpha')
  const betaContact = await make(claude!.id, repoB, 'Reviewer · beta')

  await invoke(launched.window, 'auth.completeOnboarding')
  await launched.app.close()

  seedUsage([
    // Claude, vendor-reported. $2.00 total.
    {
      contactId: claudeContact.id,
      source: 'message',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 1.5,
      model: 'claude-sonnet-5',
      costSource: 'sdk',
      timestamp: daysAgo(2)
    },
    {
      contactId: claudeContact.id,
      source: 'summary',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.5,
      model: 'claude-haiku-4-5-20251001',
      costSource: 'sdk',
      timestamp: daysAgo(2)
    },
    // Codex, computed from our price table. Two models on ONE contact, so the
    // by-model split cannot be faked by reading the persona's current setting.
    {
      contactId: codexContact.id,
      source: 'routine',
      inputTokens: 4000,
      outputTokens: 300,
      costUsd: 1.0,
      model: 'gpt-5.5',
      costSource: 'computed',
      timestamp: daysAgo(1)
    },
    {
      contactId: codexContact.id,
      source: 'routine',
      inputTokens: 2000,
      outputTokens: 100,
      costUsd: 0.25,
      model: 'gpt-5.4-mini',
      costSource: 'computed',
      timestamp: daysAgo(1)
    },
    // A model with no row in CODEX_PRICES: real tokens, unknowable cost.
    {
      contactId: codexContact.id,
      source: 'message',
      inputTokens: 900,
      outputTokens: 90,
      costUsd: null,
      model: 'gpt-6-unreleased',
      costSource: 'computed',
      timestamp: daysAgo(1)
    },
    // A row from before migration 0004, which added the model column.
    {
      contactId: betaContact.id,
      source: 'message',
      inputTokens: 700,
      outputTokens: 70,
      costUsd: 0.75,
      model: null,
      costSource: null,
      timestamp: daysAgo(3)
    }
  ])

  launched = await launchApp(profile)
  await waitForShell(launched.window)
  await launched.window.getByRole('button', { name: 'Usage' }).first().click()
})

test.afterAll(async () => {
  await launched?.app.close().catch(() => {})
  destroyProfile(profile)
  execFileSync('rm', ['-rf', scratch])
})

test('a total that excludes an unpriced turn is visibly partial', async () => {
  // 1.50 + 0.50 + 1.00 + 0.25 + 0.75 = 4.00, and one turn is unpriced. The `+`
  // is the entire point: without it this reads as the whole bill.
  await expect(reportedSpend()).toContainText('$4.00+')
  await expect(launched.window.getByText(/turn.*no published price/i).first()).toBeVisible()
})

test('both backends roll up into one comparable view', async () => {
  // The check that cannot be made against the dev profile, which holds only
  // Codex rows: a Claude contact priced by its SDK and a Codex contact priced
  // by our own table appear side by side, in dollars, in the same breakdown.
  await expect(launched.window.getByText('Totals by persona')).toBeVisible()
  await expect(launched.window.getByText(claudePersonaName).first()).toBeVisible()
  await expect(launched.window.getByText(codexPersonaName).first()).toBeVisible()
})

test('spend splits by the model that actually served each turn', async () => {
  await expect(launched.window.getByText('Totals by model')).toBeVisible()
  // One contact, two Codex models — attributed separately.
  await expect(launched.window.getByText('gpt-5.5').first()).toBeVisible()
  await expect(launched.window.getByText('gpt-5.4-mini').first()).toBeVisible()
  await expect(launched.window.getByText('claude-sonnet-5').first()).toBeVisible()
  // And the pre-0004 row is its own bucket rather than folded into a default.
  await expect(launched.window.getByText('Unknown model').first()).toBeVisible()
})

test('both repos appear in the by-repo breakdown', async () => {
  await expect(launched.window.getByText('Totals by repo')).toBeVisible()
  await expect(launched.window.getByText('alpha').first()).toBeVisible()
  await expect(launched.window.getByText('beta').first()).toBeVisible()
})

test('filtering to routines isolates unsupervised spend', async () => {
  await sourceFilter().getByText('Routines').click()

  // Only the two routine rows survive: 1.00 + 0.25, both priced, so no `+`.
  await expect(reportedSpend()).toContainText('$1.25')
  await expect(reportedSpend()).not.toContainText('+')

  await sourceFilter().getByText('All').click()
  await expect(reportedSpend()).toContainText('$4.00+')
})

test('scoping to one repo excludes the other', async () => {
  await launched.window.getByRole('button', { name: /beta/ }).click()

  // Only the beta contact's single $0.75 turn, and nothing unpriced.
  await expect(reportedSpend()).toContainText('$0.75')
  await expect(reportedSpend()).not.toContainText('+')
})
