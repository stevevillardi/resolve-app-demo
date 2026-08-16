/**
 * Drives a real backend session outside Electron.
 *
 * Phase 5 is backend-only — there is no UI to run an adapter from until Phase
 * 6 — so this is how the adapters get verified against live SDKs, and how the
 * blueprint §14 open items get settled with real numbers rather than
 * assumptions. Checked in rather than thrown away: Phases 6 and 8 will want to
 * reproduce a turn without clicking through the app.
 *
 * Usage:
 *   npm run probe:adapters -- --backend claude --repo /tmp/probe --prompt "hi"
 *   npm run probe:adapters -- --backend codex --sandbox read_only --raw
 *   npm run probe:adapters -- --backend codex --resume <threadId>
 *
 * It deliberately does NOT touch the app database: personas are built from
 * flags, so a probe run can never mutate real data.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { AgentEvent } from '../src/shared/agent'
import type { PersonaBackend, PersonaTemplate, SandboxLevel, Skill } from '../src/shared/domain'
import { adapterFor } from '../src/main/adapters'

interface Flags {
  backend: PersonaBackend
  sandbox: SandboxLevel
  repo: string
  prompt: string
  model?: string
  resume?: string
  system: string
  skillFiles: string[]
  raw: boolean
}

function parseFlags(argv: string[]): Flags {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? undefined : argv[index + 1]
  }
  const all = (name: string): string[] => {
    const values: string[] = []
    argv.forEach((arg, index) => {
      if (arg === `--${name}` && argv[index + 1]) values.push(argv[index + 1])
    })
    return values
  }

  const backend = (get('backend') ?? 'claude') as PersonaBackend
  if (backend !== 'claude' && backend !== 'codex') {
    throw new Error(`--backend must be claude or codex, got ${backend}`)
  }

  const sandbox = (get('sandbox') ?? 'read_only') as SandboxLevel
  if (!['read_only', 'workspace_write', 'full_access'].includes(sandbox)) {
    throw new Error(`--sandbox must be read_only, workspace_write or full_access, got ${sandbox}`)
  }

  return {
    backend,
    sandbox,
    repo: resolve(get('repo') ?? process.cwd()),
    prompt: get('prompt') ?? 'Reply with exactly: ok',
    model: get('model'),
    resume: get('resume'),
    system: get('system') ?? 'You are a probe. Answer briefly and do not modify anything.',
    skillFiles: all('skill'),
    raw: argv.includes('--raw')
  }
}

function loadSkills(paths: string[]): Skill[] {
  return paths.map((path, index) => ({
    id: `probe-skill-${index}`,
    name: `Probe skill ${index + 1}`,
    description: path,
    content: readFileSync(resolve(path), 'utf8')
  }))
}

/** One line per event, so a long turn stays readable in a terminal. */
function render(event: AgentEvent): string {
  switch (event.type) {
    case 'session_started':
      return `session  ${event.sessionId}`
    case 'text_delta':
      return `delta    ${JSON.stringify(event.text)}`
    case 'text_message':
      return `message  ${event.text.replace(/\n/g, '\\n').slice(0, 200)}`
    case 'reasoning':
      return `reason   ${event.text.replace(/\n/g, '\\n').slice(0, 120)}`
    case 'tool_start':
      return `tool >   ${event.name} ${event.detail ?? ''}`.trimEnd()
    case 'tool_progress':
      return `tool .   ${event.name} ${event.elapsedMs ? `${event.elapsedMs}ms` : ''}`.trimEnd()
    case 'tool_end':
      return `tool <   ${event.name || '(result)'} ${event.status}`
    case 'error':
      return `ERROR    [${event.kind}] ${event.message}`
    case 'done':
      return `done     ${event.usage ? JSON.stringify(event.usage) : 'no usage reported'}`
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  const persona: PersonaTemplate = {
    id: 'probe-persona',
    name: 'Probe',
    avatarColor: '#2a78d6',
    backend: flags.backend,
    model: null,
    systemPrompt: flags.system,
    skillIds: flags.skillFiles.map((_, index) => `probe-skill-${index}`),
    sandbox: flags.sandbox,
    githubScope: 'read_only'
  }

  // The Codex binary is normally resolved via electron's app paths; outside
  // Electron the SDK's own require.resolve lookup works fine, so nothing is
  // injected here. That difference is exactly why AdapterConfig takes a path
  // instead of resolving one itself.
  const adapter = adapterFor(flags.backend, {
    ...(flags.raw ? { onRawEvent: (event) => console.log('RAW', JSON.stringify(event)) } : {})
  })

  const spec = {
    persona,
    repoPath: flags.repo,
    skills: loadSkills(flags.skillFiles),
    ...(flags.model ? { model: flags.model } : {})
  }

  const session = flags.resume ? adapter.resume(spec, flags.resume) : adapter.createSession(spec)

  console.log(`--- ${flags.backend} / ${flags.sandbox} / ${flags.repo}`)
  console.log(`--- capabilities ${JSON.stringify(adapter.capabilities)}`)
  console.log(`--- prompt ${JSON.stringify(flags.prompt)}\n`)

  const started = Date.now()
  for await (const event of adapter.run(session, flags.prompt)) {
    console.log(render(event))
  }

  console.log(`\n--- session id for --resume: ${session.sessionId ?? '(none reported)'}`)
  console.log(`--- ${Date.now() - started}ms`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
