/**
 * Drives a real backend's structured-output path outside Electron.
 *
 * The sibling of probe-adapters.ts, and it exists for the same reason: blueprint
 * §6's compaction rule depends on schema-enforced output that neither SDK
 * documents identically, and `07-group-coordination.md` says to "confirm during
 * implementation". Reading the typings settles what the fields are called;
 * only a live run settles what actually comes back.
 *
 * Two things worth probing here specifically, because the tests in
 * src/main/adapters/*.test.ts are only as good as the fixtures captured from
 * this script (see the note on fabricated fixtures in 00-progress.md):
 *
 *   - **Claude's placeholder carrier.** A structured turn is an "end-turn tool
 *     session": it has no trailing assistant message, and `result` holds a
 *     placeholder while the real payload sits on `structured_output`. Run with
 *     --raw to see both and confirm we read the right one.
 *   - **Codex's prose fallback.** `outputSchema` is advisory in the sense that
 *     the answer still arrives in `finalResponse` as text. --raw shows whether
 *     it fenced the JSON, which is why the adapter tolerates ```json.
 *
 * Usage:
 *   npm run probe:structured -- --backend claude --raw
 *   npm run probe:structured -- --backend codex --model gpt-5.4-mini
 *   npm run probe:structured -- --backend claude --text "I renamed foo to bar because..."
 *
 * Like probe-adapters.ts it deliberately does NOT touch the app database.
 */

import { resolve } from 'path'
import type { PersonaBackend, PersonaTemplate, SandboxLevel } from '../src/shared/domain'
import { adapterFor } from '../src/main/adapters'
import { summaryModelFor } from '../src/main/adapters/models'
// The app's real schema, imported rather than copied — a probe validating its
// own private copy would prove nothing about what the app actually sends.
import { SUMMARY_JSON_SCHEMA, summarySchema } from '../src/shared/summary'

const DEFAULT_TEXT = [
  'User: the auth module re-reads the token file on every request, can you fix it?',
  '',
  'Assistant: I moved the token read into a module-level cache in src/auth.ts,',
  'invalidated on file mtime rather than on a timer. A timer would have been',
  'simpler but would keep serving a revoked token for up to its interval, which',
  'is the failure mode that matters here.'
].join('\n')

interface Flags {
  backend: PersonaBackend
  sandbox: SandboxLevel
  repo: string
  text: string
  model?: string
  raw: boolean
}

function parseFlags(argv: string[]): Flags {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? undefined : argv[index + 1]
  }

  const backend = (get('backend') ?? 'claude') as PersonaBackend
  if (backend !== 'claude' && backend !== 'codex') {
    throw new Error(`--backend must be claude or codex, got ${backend}`)
  }

  return {
    backend,
    sandbox: 'read_only',
    repo: resolve(get('repo') ?? process.cwd()),
    text: get('text') ?? DEFAULT_TEXT,
    model: get('model'),
    raw: argv.includes('--raw')
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  const persona: PersonaTemplate = {
    id: 'probe-summariser',
    avatarSeed: 'probe-summariser',
    name: 'Probe summariser',
    avatarColor: '#2a78d6',
    backend: flags.backend,
    model: null,
    systemPrompt:
      'You summarise a finished coding session for a shared project log. ' +
      'Answer only with the requested JSON object.',
    skillIds: [],
    mcpServerIds: [],
    sandbox: flags.sandbox,
    githubScope: 'read_only'
  }

  const adapter = adapterFor(flags.backend, {
    ...(flags.raw ? { onRawEvent: (event) => console.log('RAW', JSON.stringify(event)) } : {})
  })

  const model = flags.model ?? summaryModelFor(flags.backend)
  const session = adapter.createSession({
    persona,
    repoPath: flags.repo,
    skills: [],
    model
  })

  console.log(`--- ${flags.backend} / ${model} / ${flags.repo}`)
  console.log(`--- supportsStructuredOutput ${adapter.capabilities.supportsStructuredOutput}`)
  console.log(`--- transcript ${JSON.stringify(flags.text.slice(0, 120))}…\n`)

  const started = Date.now()
  const result = await adapter.summarize(
    session,
    `Summarise this session:\n\n${flags.text}`,
    SUMMARY_JSON_SCHEMA
  )

  console.log(`\ndata     ${result.data === null ? '(null — no conforming answer)' : ''}`)
  if (result.data !== null) console.log(JSON.stringify(result.data, null, 2))
  console.log(`usage    ${result.usage ? JSON.stringify(result.usage) : 'no usage reported'}`)

  // The backend saying "here is JSON" and the app being able to *use* it are
  // different claims. Validating with the app's own Zod schema is what makes a
  // green probe mean the compaction service would have written a row.
  const parsed = summarySchema.safeParse(result.data)
  console.log(`parsed   ${parsed.success ? 'ok' : `FAILED — ${parsed.error.message}`}`)
  console.log(`--- ${Date.now() - started}ms`)

  // A null or unusable answer is a legitimate outcome the service absorbs, but
  // from a probe it is the whole point of the run — make it a non-zero exit so
  // a scripted invocation notices.
  if (!parsed.success) process.exit(2)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
