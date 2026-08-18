import { readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from '@playwright/test'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  waitForShell,
  writeProfileDb,
  type LaunchedApp
} from './fixtures'

/**
 * Export, through the real app (review §G2).
 *
 * `export.test.ts` proves the two formats — that a null cost leaves as an empty
 * cell, that a reply's own Markdown survives verbatim, that a comma in a name
 * is quoted. What it cannot say is that the menu item is wired to any of it,
 * that main will actually write a file, or that the bytes on disk are the ones
 * the serializer produced. This is the app's first write outside its own
 * profile directory, so that last one is worth seeing.
 *
 * `dialog.showSaveDialog` is replaced inside main, because a native save panel
 * cannot be driven. Nothing else is stubbed: the write is the real `writeFile`.
 */

test.describe.configure({ mode: 'serial' })

let profile: string
let launched: LaunchedApp
let outDir: string
let contactId: string

test.beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'switchboard-export-'))
  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
  await invoke(launched.window, 'auth.completeOnboarding')

  const persona = await invoke<{ id: string }>(launched.window, 'personas.create', {
    name: 'Export Reader',
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: 'claude-sonnet-5',
    systemPrompt: 'Read.',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  })
  const contact = await invoke<{ id: string }>(launched.window, 'contacts.create', {
    personaTemplateId: persona.id,
    repoPath: profile,
    displayName: 'Export Reader',
    isolation: 'shared'
  })
  contactId = contact.id

  await launched.app.close()

  const now = Date.now()
  writeProfileDb(
    profile,
    `insert into messages (id, contact_id, role, content, timestamp)
     values (?, ?, 'user', 'what changed?', ?)`,
    'm1',
    contactId,
    now - 60_000
  )
  // A reply carrying its own fenced code, which is the case that decides the
  // Markdown format — quoting it would mean rewriting every line.
  writeProfileDb(
    profile,
    `insert into messages (id, contact_id, role, content, timestamp)
     values (?, ?, 'assistant', ?, ?)`,
    'm2',
    contactId,
    '## Findings\n\n```ts\nconst safe = true\n```',
    now - 50_000
  )
  // One priced turn and one with no published price, so the export has to carry
  // both — the unpriced one is the whole reason this format is careful.
  writeProfileDb(
    profile,
    `insert into usage_events
       (id, contact_id, timestamp, source, input_tokens, output_tokens, cost_usd, model, message_id)
     values (?, ?, ?, 'message', 4200, 310, 0.0731, 'claude-sonnet-5', 'm2')`,
    'u1',
    contactId,
    now - 50_000
  )
  writeProfileDb(
    profile,
    `insert into usage_events
       (id, contact_id, timestamp, source, input_tokens, output_tokens, cost_usd, model)
     values (?, ?, ?, 'summary', 900, 40, null, 'gpt-9-unknown')`,
    'u2',
    contactId,
    now - 40_000
  )

  launched = await launchApp(profile)
  await waitForShell(launched.window)
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
  rmSync(outDir, { recursive: true, force: true })
})

/** Points the save panel at a known file and returns what landed there. */
async function saveTo(name: string, run: () => Promise<void>): Promise<string> {
  const target = join(outDir, name)
  await launched.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () =>
      Promise.resolve({ canceled: false, filePath }) as ReturnType<typeof dialog.showSaveDialog>
  }, target)

  await run()
  await expect(async () => readFileSync(target, 'utf8')).toPass({ timeout: 5000 })
  return readFileSync(target, 'utf8')
}

test('a conversation exports as Markdown, with its costs and its code intact', async () => {
  const { window } = launched
  await window.getByRole('button', { name: 'Chats', exact: true }).click()
  await window.getByText('Export Reader').first().click()

  const written = await saveTo('thread.md', async () => {
    await window.getByRole('button', { name: 'Manage Export Reader' }).click()
    await window.getByRole('menuitem', { name: 'Export conversation…' }).click()
    await window.getByRole('button', { name: 'Choose a location…' }).click()
  })

  expect(written).toContain('# Export Reader')
  expect(written).toContain('### You')
  expect(written).toContain('what changed?')
  // Verbatim, fences and all.
  expect(written).toContain('```ts\nconst safe = true\n```')
  // The per-turn cost, from the usage row linked to that reply.
  expect(written).toContain('4,200 in · 310 out · $0.0731')
})

test('usage exports as CSV, with an unknown cost left blank rather than zero', async () => {
  const { window } = launched
  await window.getByRole('button', { name: 'Usage', exact: true }).click()

  const written = await saveTo('usage.csv', async () => {
    await window.getByRole('button', { name: 'CSV' }).click()
  })

  const [header, ...rows] = written.trim().split('\n')
  expect(header).toContain('cost_usd')
  expect(rows).toHaveLength(2)

  const costs = rows.map((row) => row.split(',')[header.split(',').indexOf('cost_usd')])
  expect(costs).toContain('0.073100')
  // The claim the whole format is built around: unknown is empty, never 0.
  expect(costs).toContain('')
  expect(costs).not.toContain('0.000000')
})

test('cancelling the save panel writes nothing and says nothing', async () => {
  const { window } = launched
  await launched.app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () =>
      Promise.resolve({ canceled: true, filePath: undefined }) as ReturnType<
        typeof dialog.showSaveDialog
      >
  })

  await window.getByRole('button', { name: 'CSV' }).click()
  // A toast saying "nothing was saved" after somebody pressed Escape is the app
  // talking about itself; the absence is the assertion.
  await expect(window.getByText(/^Saved /)).toHaveCount(0)
})
