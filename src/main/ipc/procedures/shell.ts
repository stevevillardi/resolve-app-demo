import { shell } from 'electron'
import { registerProcedure } from '../registerProcedure'

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
