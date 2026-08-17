/**
 * Drives the GitHub MCP server, and the two backends' MCP configuration, outside
 * Electron.
 *
 * The sibling of probe-adapters.ts and probe-structured.ts, and it exists
 * because Phase 14 shipped two things on evidence weaker than a live run:
 *
 *   1. `src/main/adapters/github-mcp-tools.ts` is a transcription of a
 *      `tools/list` response taken on 2026-08-16 — 27 read, 17 write, 44 total.
 *      The whole deny table is derived from the difference between the two
 *      endpoints, so a name that drifts is a hole nothing else notices. `--list`
 *      re-reads both and reports the drift.
 *   2. The Codex `mcp_servers` block was written from `codex mcp add --help` and
 *      from the binary's own serde field list, read with `strings`.
 *      `CodexOptions.config` is an open index signature, so a misspelled key is
 *      **silently ignored** rather than a type error — the failure mode is a
 *      server that looks configured and either is not there at all or is there
 *      without its deny list. `--codex` settles it against a real turn.
 *
 * It also answers the one open SDK question from the phase: whether Claude's
 * per-server `permission_policy: 'always_deny'` survives
 * `permissionMode: 'bypassPermissions'`. If it does, that is a third gate worth
 * having; if it does not, `disallowedTools` staying primary is load-bearing
 * rather than merely cautious. `--policy` measures it.
 *
 * Usage:
 *   npm run probe:mcp -- --list
 *   npm run probe:mcp -- --codex
 *   npm run probe:mcp -- --claude
 *   npm run probe:mcp -- --policy
 *   npm run probe:mcp -- --all
 *
 * Needs a GitHub token in PERSONA_ROUTER_GITHUB_MCP_TOKEN or GITHUB_TOKEN. Like
 * its siblings it deliberately does NOT touch the app database or the OS
 * keychain — nothing here can read the token the app itself stored, on purpose,
 * so a probe run can never mutate or leak real credentials.
 */

import {
  GITHUB_MCP_READ_TOOLS,
  GITHUB_MCP_READONLY_URL,
  GITHUB_MCP_SERVER_ID,
  GITHUB_MCP_TOKEN_ENV,
  GITHUB_MCP_URL,
  GITHUB_MCP_WRITE_TOOLS,
  qualifiedGithubToolName
} from '../src/main/adapters/github-mcp-tools'
import { adapterFor } from '../src/main/adapters'
import type { PersonaTemplate } from '../src/shared/domain'
import type { ResolvedServer, SessionSpec } from '../src/main/adapters/types'

function token(): string {
  const value = process.env[GITHUB_MCP_TOKEN_ENV] ?? process.env.GITHUB_TOKEN
  if (!value) {
    throw new Error(
      `No token. Set ${GITHUB_MCP_TOKEN_ENV} or GITHUB_TOKEN — this script never reads the app's keychain.`
    )
  }
  return value
}

/**
 * One `tools/list` call over Streamable HTTP.
 *
 * Hand-rolled rather than pulled from an MCP client library: the handshake is
 * two POSTs, and adding a dependency to a probe script would mean the thing
 * being measured is partly the library. `Accept` must name both content types
 * or the server answers 406.
 */
async function listTools(url: string, bearer: string): Promise<string[]> {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${bearer}`
  }

  const initialize = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'persona-router-probe', version: '0.1.0' }
      }
    })
  })
  if (!initialize.ok) {
    throw new Error(`initialize failed: ${initialize.status} ${await initialize.text()}`)
  }
  // The server assigns a session id on initialize and requires it thereafter.
  const session = initialize.headers.get('mcp-session-id')

  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  })
  if (!response.ok) {
    throw new Error(`tools/list failed: ${response.status} ${await response.text()}`)
  }

  // Streamable HTTP may answer as SSE even for a unary call, so take the last
  // `data:` line when it does rather than assuming a JSON body.
  const body = await response.text()
  const payload =
    body.startsWith('event:') || body.startsWith('data:')
      ? body
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
      : body

  const parsed = JSON.parse(payload) as { result?: { tools?: { name: string }[] } }
  return (parsed.result?.tools ?? []).map((tool) => tool.name).sort()
}

function reportDrift(label: string, captured: readonly string[], live: string[]): boolean {
  const capturedSet = new Set(captured)
  const liveSet = new Set(live)
  const added = live.filter((name) => !capturedSet.has(name))
  const removed = [...captured].filter((name) => !liveSet.has(name))

  console.log(`\n${label}: ${live.length} live, ${captured.length} in github-mcp-tools.ts`)
  if (added.length === 0 && removed.length === 0) {
    console.log('  no drift')
    return false
  }
  if (added.length > 0) console.log(`  NEW, not in our table:      ${added.join(', ')}`)
  if (removed.length > 0) console.log(`  GONE, still in our table:   ${removed.join(', ')}`)
  return true
}

/**
 * Job 1 — refresh the inventory.
 *
 * The write set is *derived*, not declared: it is whatever `/mcp/` serves that
 * `/mcp/readonly` does not. That is the property making the deny table
 * maintainable, so it is recomputed here rather than compared field by field.
 */
async function probeList(): Promise<void> {
  const bearer = token()
  const readOnly = await listTools(GITHUB_MCP_READONLY_URL, bearer)
  const full = await listTools(GITHUB_MCP_URL, bearer)
  const writes = full.filter((name) => !readOnly.includes(name))

  const readDrift = reportDrift('read tools  (/mcp/readonly)', GITHUB_MCP_READ_TOOLS, readOnly)
  const writeDrift = reportDrift(
    'write tools (/mcp/ minus readonly)',
    GITHUB_MCP_WRITE_TOOLS,
    writes
  )

  console.log(
    `\narithmetic: ${readOnly.length} + ${writes.length} = ${full.length}` +
      (readOnly.length + writes.length === full.length ? '  ok' : '  MISMATCH')
  )
  if (readDrift || writeDrift) {
    console.log('\nDrift found. Update src/main/adapters/github-mcp-tools.ts from the lists above,')
    console.log('and re-check githubMcpDenyList() in sandbox.ts — a new write tool is reachable')
    console.log('at open_pr until it is named.')
  }
}

function persona(overrides: Partial<PersonaTemplate> = {}): PersonaTemplate {
  return {
    id: 'probe',
    name: 'Probe',
    avatarColor: '#888888',
    backend: 'claude',
    model: null,
    systemPrompt: 'You are a probe. Answer in one short sentence.',
    skillIds: [],
    mcpServerIds: [GITHUB_MCP_SERVER_ID],
    sandbox: 'read_only',
    githubScope: 'read_only',
    ...overrides
  }
}

function server(overrides: Partial<ResolvedServer> = {}): ResolvedServer {
  return {
    id: GITHUB_MCP_SERVER_ID,
    url: GITHUB_MCP_READONLY_URL,
    token: token(),
    tokenEnvVar: GITHUB_MCP_TOKEN_ENV,
    deniedTools: [...GITHUB_MCP_WRITE_TOOLS],
    disallowedTools: GITHUB_MCP_WRITE_TOOLS.map(qualifiedGithubToolName),
    ...overrides
  }
}

async function runTurn(spec: SessionSpec, prompt: string): Promise<void> {
  const adapter = adapterFor(spec.persona.backend, {
    env: { [GITHUB_MCP_TOKEN_ENV]: token() }
  })
  const session = adapter.createSession(spec)

  for await (const event of adapter.run(session, prompt)) {
    if (event.type === 'tool_start') console.log(`  → ${event.name}  ${event.detail ?? ''}`)
    if (event.type === 'tool_end') console.log(`  ← ${event.name}  ${event.status}`)
    if (event.type === 'error') console.log(`  ! ${event.kind}: ${event.message}`)
    if (event.type === 'done') console.log(`\n${event.finalText}`)
  }
}

/**
 * Job 2 — does Codex accept the config block we build for it?
 *
 * The answer is in whether a `mcp_tool_call` item appears at all. A wrong key
 * under `mcp_servers` does not error; the server simply is not there, and the
 * model says it has no way to check GitHub. That is the outcome this run
 * distinguishes from success.
 */
async function probeCodex(): Promise<void> {
  console.log('Codex, mcp_servers config, read-only endpoint:')
  await runTurn(
    {
      persona: persona({ backend: 'codex' }),
      repoPath: process.cwd(),
      skills: [],
      mcpServers: [server()]
    },
    'Using the github tools, how many open issues does the repository anthropics/claude-code have? If you have no github tool available, say exactly: NO GITHUB TOOL.'
  )
}

async function probeClaude(): Promise<void> {
  console.log('Claude, mcpServers option, read-only endpoint:')
  await runTurn(
    {
      persona: persona(),
      repoPath: process.cwd(),
      skills: [],
      mcpServers: [server()]
    },
    'Using the github tools, how many open issues does the repository anthropics/claude-code have? If you have no github tool available, say exactly: NO GITHUB TOOL.'
  )
}

/**
 * Job 3 — the open SDK question.
 *
 * `McpHttpServerConfig.tools[].permission_policy` is typed in the SDK
 * (sdk.d.ts:1125) and never exercised by this app. `bypassPermissions` is known
 * to skip `canUseTool` entirely, which is why `disallowedTools` is the primary
 * gate; if the per-server policy survives it too, it is a stronger third layer,
 * because the CLI enforces it per server rather than by matching a name.
 *
 * **Measured with a read tool on the read-only endpoint, deliberately.** The
 * obvious version of this probe denies a *write* tool by policy alone and sees
 * whether the model can still comment — but the only way that experiment
 * reports "the policy does not hold" is by actually posting a comment on a real
 * repository. Denying `search_issues` answers exactly the same question about
 * exactly the same mechanism, and the worst case is a search that succeeds.
 *
 * Goes through `query()` directly rather than the adapter, because the adapter
 * has no `tools` policy field — this measures an SDK behaviour the app has not
 * adopted, which is the whole point of asking.
 */
async function probePolicy(): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  console.log('permission_policy under bypassPermissions:')
  console.log('  search_issues denied by policy only — not in disallowedTools')
  console.log('  read-only endpoint, so nothing can be written whatever the answer\n')

  const stream = query({
    prompt:
      'Use the github tool search_issues to find open issues in anthropics/claude-code. ' +
      'Report exactly what happened — if a tool was refused, quote the refusal verbatim.',
    options: {
      cwd: process.cwd(),
      systemPrompt: 'You are a probe. Try the tool once and report the outcome literally.',
      settingSources: [],
      strictMcpConfig: true,
      // What the app sets at sandbox: full_access, and the reason canUseTool
      // cannot be the gate there.
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      // Empty on purpose. If this carried the name, it would be what refused
      // and the measurement would say nothing about the policy.
      disallowedTools: [],
      mcpServers: {
        [GITHUB_MCP_SERVER_ID]: {
          type: 'http',
          url: GITHUB_MCP_READONLY_URL,
          headers: { Authorization: `Bearer ${token()}` },
          tools: [{ name: 'search_issues', permission_policy: 'always_deny' }]
        }
      },
      env: process.env as Record<string, string>
    }
  })

  for await (const message of stream) {
    const m = message as { type?: string; result?: string }
    if (m.type === 'result') console.log(m.result)
  }

  console.log('\nA refusal means the policy survives bypassPermissions — a real third gate.')
  console.log('A successful search means disallowedTools is the only gate that does,')
  console.log('and github-mcp-tools.ts staying primary is load-bearing rather than cautious.')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const want = (flag: string): boolean => argv.includes(`--${flag}`) || argv.includes('--all')

  if (argv.length === 0) {
    console.log('Nothing to do. Try --list, --codex, --claude, --policy, or --all.')
    return
  }

  if (want('list')) await probeList()
  if (want('codex')) await probeCodex()
  if (want('claude')) await probeClaude()
  if (want('policy')) await probePolicy()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
