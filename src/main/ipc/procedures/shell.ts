import { shell } from 'electron'
import { registerProcedure } from '../registerProcedure'
import { isKnownLocalPath } from '../../services/local-paths'
import { saveTextFile } from '../../services/files'

/**
 * The renderer can ask to open a verification URL in the real browser, but not
 * to open anything it likes — an allowlist keeps this from becoming a general
 * "main process opens whatever the renderer says" primitive.
 */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'auth.openai.com',
  'chatgpt.com',
  'platform.openai.com',
  'console.anthropic.com'
])

registerProcedure('shell.openExternal', async ({ url }) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return { opened: false }
  }
  await shell.openExternal(parsed.toString())
  return { opened: true }
})

// Local paths: same shape as the URL allowlist above — the roots are what the
// app already knows (bound repos, its own worktrees), validated in
// services/local-paths.ts where the rule has tests.
registerProcedure('shell.openPath', async ({ path }) => {
  if (!isKnownLocalPath(path)) return { opened: false }
  const failure = await shell.openPath(path)
  return { opened: failure === '' }
})

registerProcedure('shell.revealPath', async ({ path }) => {
  if (!isKnownLocalPath(path)) return { revealed: false }
  shell.showItemInFolder(path)
  return { revealed: true }
})

/**
 * Export. Deliberately in this module rather than a new one: it is the same
 * kind of thing as the two above — a request to reach outside the profile
 * directory — and keeping them together means the next person adding one reads
 * the allowlist rule and the reason this one is exempt in one place.
 */
registerProcedure('files.saveText', async (input) => ({
  path: await saveTextFile(input)
}))
