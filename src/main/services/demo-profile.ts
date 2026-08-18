import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { deleteContact, listContacts } from './contacts'
import { seedDemoData, wipeForDemo } from './demo-seed'
import { plannedWorktree } from './worktrees'

/**
 * `SWITCHBOARD_DEMO=1` (npm run demo): rebuild the profile as a staged
 * showcase on every launch, so a walkthrough always starts from the same
 * pristine, fully-populated state — however the last rehearsal ended.
 *
 * The staging is destructive to *content* on purpose and to nothing else:
 * contacts leave through the same deleteContact path a user's delete takes
 * (so real repositories' worktree registrations are cleaned, not stranded),
 * and the wipe preserves the app-state keys that are identity rather than
 * content — see PRESERVED_APP_STATE. Backend logins and the GitHub token
 * never lived in this database at all.
 *
 * Two repositories get bound:
 *
 * - the Switchboard checkout itself (`app.getAppPath()` in dev, overridable
 *   with SWITCHBOARD_DEMO_REPO), so the personas discussing the app's own
 *   bugs can actually be asked about the real code live — or a small
 *   stand-in, fabricated when no checkout is there to bind.
 * - a scratch marketing-site repo under <userData>/demo, always fabricated,
 *   which is where everything git-visible happens: the persona branch, its
 *   worktree, the commit and the dirty file the Branches panel shows. The
 *   demo stages no branch in the real repository.
 */

export function demoRequested(): boolean {
  return process.env['SWITCHBOARD_DEMO'] === '1'
}

export async function stageDemoProfile(): Promise<void> {
  // Through the real delete path first, so a previous profile's worktrees are
  // unregistered from their repos before the rows vanish. A repo that has
  // since been moved or deleted must not stop the demo from staging.
  for (const contact of listContacts()) {
    await deleteContact(contact.id, true).catch((error) => {
      console.warn(`[demo] could not clean up ${contact.displayName}:`, error)
    })
  }
  wipeForDemo()

  const demoRoot = join(app.getPath('userData'), 'demo')
  rmSync(demoRoot, { recursive: true, force: true })

  const siteRepo = join(demoRoot, 'switchboard-site')
  buildSiteRepo(siteRepo)

  const candidate = process.env['SWITCHBOARD_DEMO_REPO'] ?? app.getAppPath()
  const appRepo = existsSync(join(candidate, '.git'))
    ? candidate
    : buildFallbackAppRepo(join(demoRoot, 'switchboard'))

  const ids = {
    reviewer: randomUUID(),
    hunter: randomUUID(),
    tester: randomUUID(),
    docs: randomUUID(),
    refactor: randomUUID(),
    release: randomUUID()
  }

  const refactorPlan = plannedWorktree(siteRepo, 'Refactor Buddy', ids.refactor)
  const testerPlan = plannedWorktree(appRepo, 'Test Author', ids.tester)
  const refactor = materialiseRefactorBranch(siteRepo, refactorPlan.path, refactorPlan.branch)

  seedDemoData({
    now: Date.now(),
    appRepo,
    siteRepo,
    ids,
    refactor: { ...refactorPlan, ...refactor },
    tester: testerPlan
  })
}

function git(cwd: string, args: string[], dateIso?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(dateIso ? { GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso } : {})
    }
  }).trim()
}

function commit(cwd: string, message: string, daysAgo: number, author?: string): void {
  const dateIso = new Date(Date.now() - daysAgo * 24 * 3600_000).toISOString()
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '-q', ...(author ? ['--author', author] : []), '-m', message], dateIso)
}

/** The four ad-hoc gutters demo-m-16 complains about. */
const SITE_CSS_BEFORE = `:root {
  --ink: #1c1a17;
  --paper: #faf8f4;
}
body { margin: 0; padding: 28px; color: var(--ink); background: var(--paper); }
header { margin-bottom: 22px; }
main section { padding: 18px; margin-bottom: 22px; }
footer { margin-top: 28px; padding: 14px; }
`

/** What the branch commits: everything on one 8px scale. */
const SITE_CSS_AFTER = `:root {
  --ink: #1c1a17;
  --paper: #faf8f4;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
}
body { margin: 0; padding: var(--space-4); color: var(--ink); background: var(--paper); }
header { margin-bottom: var(--space-3); }
main section { padding: var(--space-2); margin-bottom: var(--space-3); }
footer { margin-top: var(--space-4); padding: var(--space-2); }
`

function buildSiteRepo(path: string): void {
  mkdirSync(path, { recursive: true })
  git(path, ['init', '-q', '-b', 'main'])
  git(path, ['config', 'user.email', 'demo@switchboard.local'])
  git(path, ['config', 'user.name', 'Switchboard Demo'])

  writeFileSync(
    join(path, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Switchboard</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header><h1>Switchboard</h1></header>
    <main>
      <section><p>Your repositories, staffed.</p></section>
      <section style="margin-bottom: 22px"><p>Personas that answer like colleagues.</p></section>
    </main>
    <footer><p>&copy; 2026</p></footer>
  </body>
</html>
`
  )
  writeFileSync(join(path, 'styles.css'), SITE_CSS_BEFORE)
  writeFileSync(
    join(path, 'README.md'),
    '# switchboard-site\n\nThe marketing site. Static, no build step: edit, open, ship.\n'
  )
  commit(path, 'feat(site): first cut of the landing page', 12)

  mkdirSync(join(path, 'copy'), { recursive: true })
  writeFileSync(
    join(path, 'copy', 'pricing.md'),
    '# Pricing\n\n> DRAFT — numbers not final.\n\nFree while in preview.\n'
  )
  commit(path, 'docs(copy): pricing deck, still marked draft', 4)
}

/**
 * The one place the demo touches git state a panel will read: a `persona/*`
 * branch in the scratch repo with one real commit and one dirty file, made
 * exactly the way the app would have — worktree under the app's own directory,
 * commit authored by the persona.
 */
function materialiseRefactorBranch(
  repoPath: string,
  worktreePath: string,
  branch: string
): { headBefore: string; headAfter: string } {
  const headBefore = git(repoPath, ['rev-parse', 'HEAD'])

  mkdirSync(dirname(worktreePath), { recursive: true })
  git(repoPath, ['worktree', 'add', '-q', '-b', branch, worktreePath])

  writeFileSync(join(worktreePath, 'styles.css'), SITE_CSS_AFTER)
  commit(
    worktreePath,
    'refactor(css): one spacing scale instead of four gutters',
    0.25,
    'Refactor Buddy <refactor-buddy@personas.switchboard.local>'
  )
  const headAfter = git(repoPath, ['rev-parse', branch])

  // The uncommitted follow-up demo-m-17 mentions: the inline margin swapped
  // for the token, left dirty for the human to look at.
  writeFileSync(
    join(worktreePath, 'index.html'),
    git(worktreePath, ['show', 'HEAD:index.html']).replace(
      ' style="margin-bottom: 22px"',
      ' class="stack"'
    ) + '\n'
  )

  return { headBefore, headAfter }
}

/**
 * Only when there is no checkout to bind (a packaged build pointed nowhere):
 * a stand-in just deep enough that @file completion and the context panel
 * have something true to show.
 */
function buildFallbackAppRepo(path: string): string {
  mkdirSync(join(path, 'src', 'main', 'services'), { recursive: true })
  git(path, ['init', '-q', '-b', 'main'])
  git(path, ['config', 'user.email', 'demo@switchboard.local'])
  git(path, ['config', 'user.name', 'Switchboard Demo'])

  writeFileSync(
    join(path, 'README.md'),
    '# Switchboard\n\nDesktop orchestration for persistent AI persona contacts.\n'
  )
  writeFileSync(
    join(path, 'package.json'),
    JSON.stringify({ name: 'switchboard', version: '0.1.0', private: true }, null, 2) + '\n'
  )
  writeFileSync(
    join(path, 'src', 'main', 'services', 'sandbox.ts'),
    'export function classifyCommand(command: string): "read" | "write" {\n' +
      "  return /\\b(tee|dd|sed .*-i)\\b/.test(command) ? 'write' : 'read'\n" +
      '}\n'
  )
  commit(path, 'chore: stand-in checkout for the demo profile', 14)
  return path
}
