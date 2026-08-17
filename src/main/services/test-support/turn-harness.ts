import { contacts, personaTemplates, skills } from '../../db/schema'
import type { AppDatabase } from '../../db/create'
import type { AgentEvent, AgentUsage } from '../../../shared/agent'
import type { SandboxLevel } from '../../../shared/domain'

/**
 * The scripted backend the turn-loop tests run against.
 *
 * Shared rather than copied because two files now need it — `messaging.test.ts`
 * for the pipeline itself and `scheduler.test.ts` for what a routine does to it
 * — and a second copy of a 100-line harness is exactly the drift the decision
 * log warns about: the two would agree about different things and both stay
 * green. Same reasoning that put `createTestDb` in `db/test-db.ts`.
 *
 * Not a `.test.ts`, so vitest does not collect it as a suite.
 *
 * What it deliberately does *not* fake is the database: callers pair this with
 * a real in-memory SQLite carrying the checked-in migrations, because the point
 * of most assertions in both files is what ends up on disk.
 */

export interface CreatedSession {
  resumedFrom: string | null
  model?: string
  skillNames: string[]
  groupContext: { content: string }[]
  usageBaseline: AgentUsage | null
  /**
   * What the session was given beyond its own working directory. Captured so
   * the turn loop's *wiring* can be asserted — that capabilitiesFor() is
   * actually consulted per turn — separately from capabilities.test.ts, which
   * asserts what that function decides.
   */
  mcpServerIds: string[]
  repoSkills: string[]
  injectedSkillNames: string[]
  repoInstructions: string | null
}

interface SpecLike {
  model?: string
  skills: { name: string }[]
  groupContext?: { content: string }[]
  usageBaseline?: AgentUsage | null
  mcpServers?: { id: string }[]
  repoSkills?: string[]
  injectedSkills?: { name: string }[]
  repoInstructions?: { content: string }
}

export interface TurnHarness {
  /** Events the fake adapter yields, per run. Reassign to change a turn. */
  script: AgentEvent[]
  /**
   * Scripts consumed one per `run()` call, ahead of `script`. Lets a test give
   * a turn's *retry* different events from its first attempt — the self-heal
   * path re-enters run() inside a single logical turn, where reassigning
   * `script` between attempts is impossible.
   */
  scriptQueue: AgentEvent[][]
  /** Set to make the adapter throw instead of yielding — the escaped-error path. */
  throwOnRun: Error | null
  /** Blocks the stream so a turn can be observed mid-flight. */
  gate: { promise: Promise<void>; open: () => void } | null
  /** What the adapter reports as the resume key at `session_started`. */
  sessionIdToReport: string | null
  /** The AbortSignal handed to the most recent run. */
  lastSignal: AbortSignal | null
  created: CreatedSession[]
  adapter: unknown
  reset(): void
}

export const DEFAULT_USAGE: AgentUsage = {
  inputTokens: 120,
  outputTokens: 45,
  cachedInputTokens: 8960,
  costUsd: 0.0031,
  costSource: 'sdk',
  model: 'claude-haiku-4-5-20251001'
}

export function defaultScript(): AgentEvent[] {
  return [
    { type: 'session_started', sessionId: 'session-abc' },
    { type: 'text_message', text: 'Looks good.' },
    { type: 'done', finalText: 'Looks good.', usage: DEFAULT_USAGE }
  ]
}

export function createTurnHarness(): TurnHarness {
  const harness: TurnHarness = {
    script: defaultScript(),
    scriptQueue: [],
    throwOnRun: null,
    gate: null,
    sessionIdToReport: 'session-abc',
    lastSignal: null,
    created: [],
    adapter: null,
    reset() {
      harness.script = defaultScript()
      harness.scriptQueue = []
      harness.throwOnRun = null
      harness.gate = null
      harness.sessionIdToReport = 'session-abc'
      harness.lastSignal = null
      harness.created.length = 0
    }
  }

  const record = (spec: SpecLike, resumedFrom: string | null): void => {
    harness.created.push({
      resumedFrom,
      ...(spec.model !== undefined && { model: spec.model }),
      skillNames: spec.skills.map((skill) => skill.name),
      groupContext: spec.groupContext ?? [],
      usageBaseline: spec.usageBaseline ?? null,
      mcpServerIds: (spec.mcpServers ?? []).map((server) => server.id),
      repoSkills: spec.repoSkills ?? [],
      injectedSkillNames: (spec.injectedSkills ?? []).map((skill) => skill.name),
      repoInstructions: spec.repoInstructions?.content ?? null
    })
  }

  harness.adapter = {
    backend: 'claude' as const,
    capabilities: {
      streamsTextDeltas: true,
      streamsToolProgress: true,
      costSource: 'sdk' as const,
      sandboxEnforcement: 'os' as const,
      supportsStructuredOutput: true
    },
    createSession(spec: SpecLike) {
      record(spec, null)
      return { backend: 'claude' as const, spec, sessionId: null as string | null }
    },
    resume(spec: SpecLike, sessionId: string) {
      record(spec, sessionId)
      return { backend: 'claude' as const, spec, sessionId: sessionId as string | null }
    },
    async *run(
      session: { sessionId: string | null },
      _prompt: string,
      signal?: AbortSignal
    ): AsyncIterable<AgentEvent> {
      harness.lastSignal = signal ?? null
      if (harness.throwOnRun) throw harness.throwOnRun

      const script = harness.scriptQueue.shift() ?? harness.script
      for (const event of script) {
        if (harness.gate) await harness.gate.promise
        // Mirrors the real adapters: the resume key is filled in mid-stream,
        // not known up front.
        if (event.type === 'session_started') session.sessionId = harness.sessionIdToReport
        yield event
      }
    }
  }

  return harness
}

/** A gate a test can hold a turn open with, then release. */
export function openableGate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/**
 * Lets the microtask queue drain so the un-awaited runTurn() can finish.
 *
 * The depth is plumbing, not a claim — it only has to exceed the number of
 * awaits on the longest turn path (Phase 19's work capture added one), with
 * headroom so the next await added doesn't fail every suite at once.
 */
export async function settle(turns = 16): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve()
}

// --- Seeding ----------------------------------------------------------------

export const REPO = '/Users/dev/my-app'

export function seedSkill(db: AppDatabase, id = 'skill-1'): void {
  db.insert(skills)
    .values({ id, name: 'Review checklist', description: '', content: 'Be thorough.' })
    .run()
}

export function seedPersona(
  db: AppDatabase,
  id: string,
  sandbox: SandboxLevel,
  model: string | null = null
): void {
  db.insert(personaTemplates)
    .values({
      id,
      name: `Persona ${id}`,
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Review carefully.',
      skillIds: ['skill-1'],
      sandbox,
      githubScope: 'read_only',
      model
    })
    .run()
}

export function seedContact(db: AppDatabase, id: string, personaId: string, repoPath = REPO): void {
  db.insert(contacts)
    .values({
      id,
      personaTemplateId: personaId,
      repoPath,
      displayName: `Contact ${id}`,
      backendSessionId: null
    })
    .run()
}
