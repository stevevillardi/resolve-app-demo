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

/**
 * The real thing, not a probe-only copy — blueprint §6's shape plus the branch
 * field `12-worktree-isolation.md` asked Phase 7 to leave room for.
 *
 * Kept in step with summarySchema in src/main/services/compaction.ts by hand.
 * A probe that validated against its own private schema would prove nothing
 * about the one the app uses.
 */
const SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'One or two sentences on what was decided or done, in past tense.'
    },
    category: {
      type: 'string',
      enum: ['decision', 'tradeoff', 'routine'],
      description:
        'decision: a choice future work must respect. tradeoff: a choice with a cost worth recording. routine: everything else.'
    },
    branch: {
      type: 'string',
      description: 'The git branch the work landed on, if the session created or switched to one.'
    }
  },
  required: ['summary', 'category'],
  additionalProperties: false
}

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
    name: 'Probe summariser',
    avatarColor: '#2a78d6',
    backend: flags.backend,
    model: null,
    systemPrompt:
      'You summarise a finished coding session for a shared project log. ' +
      'Answer only with the requested JSON object.',
    skillIds: [],
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
  console.log(`--- ${Date.now() - started}ms`)

  // A null answer is a legitimate outcome the service absorbs, but from a probe
  // it is the whole point of the run — make it a non-zero exit so a scripted
  // invocation notices.
  if (result.data === null) process.exit(2)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
