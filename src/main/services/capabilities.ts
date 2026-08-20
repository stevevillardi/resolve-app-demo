import { discoverCodexSkills } from '../adapters/codex'
import { GITHUB_MCP_SERVER_ID, GITHUB_MCP_TOKEN_ENV } from '../adapters/github-mcp-tools'
import { githubMcpDenyList, githubMcpDisallowedTools, githubMcpEndpoint } from '../adapters/sandbox'
import { getGitHubStatus, getGitHubToken } from './github-auth'
import {
  discoverRepoSkills,
  readRepoInstructions,
  type RepoInstructions,
  type RepoSkill
} from './repo-instructions'
import { workingPathFor } from './run-lock'
import { repoTrustOf, type Contact, type PersonaTemplate } from '../../shared/domain'

/**
 * The one place that turns *this Contact, this persona* into concrete backend
 * capability configuration.
 *
 * Lives in services/ because it reads the database's Contact, the machine's
 * filesystem and the OS keychain — all three forbidden under src/main/adapters/
 * (adapters/types.ts). The adapters take the resolved result on SessionSpec,
 * which is the same division `skills`, `groupContext`, `siblingBranches` and
 * `writablePaths` already follow.
 *
 * Synchronous, and that is not an accident of convenience: getGitHubToken() and
 * getGitHubStatus() are sync, and every filesystem read here follows the
 * readFileSync-in-a-try/catch style the rest of services/ uses. So this resolves
 * inside the spec literal in messaging.ts alongside skillsForPersona() rather
 * than in the `await` slot at the top of runTurn(), which exists only because
 * git is async.
 *
 * A curated registry, not an add-a-server-by-URL field. One entry today. An
 * arbitrary server is a trust surface with no gate behind it, and this module
 * is entirely about what stands behind the gates.
 */

/** Why a server the persona was granted could not actually be offered. */
export interface UnavailableServer {
  id: string
  reason: string
}

export interface ResolvedMcpServer {
  id: string
  /** URL-scoped by GitHub itself; `read_only` never reaches a write endpoint. */
  url: string
  /** Sent by Claude as an Authorization header; by Codex through the env. */
  token: string
  /** Which variable the token is in, for Codex's `bearer_token_env_var`. */
  tokenEnvVar: string
  /** Bare tool names, the second layer. See githubMcpDenyList(). */
  deniedTools: string[]
  /** The same table qualified as `mcp__github__*`, for `disallowedTools`. */
  disallowedTools: string[]
}

export interface ResolvedCapabilities {
  /** Servers actually offered to this session. */
  mcpServers: ResolvedMcpServer[]
  /**
   * Servers granted but not offered, with the reason. Never silently dropped —
   * a persona that cannot reach GitHub because nobody connected an account
   * should say so once, not behave as though it looked and found nothing.
   */
  unavailable: UnavailableServer[]
  /** The repo's own instructions, or null when not trusted or not present. */
  repoInstructions: RepoInstructions | null
  /**
   * Approved skills the backend will discover for itself — Codex only, and only
   * for the roots Codex actually scans. Naming one here means the seal in
   * codexConfigFor() stops disabling it.
   */
  nativeSkillNames: string[]
  /**
   * Approved skills the app has to describe itself, because the backend cannot
   * find them: everything on Claude (`settingSources` stays `[]`, and the SDK's
   * `skills` option is a filter over what was discovered rather than a discovery
   * mechanism), and `.claude/skills` entries on Codex.
   */
  injectedSkills: RepoSkill[]
}

/**
 * Everything this Contact may reach that is not a file in its working
 * directory.
 *
 * Two independent inputs, deliberately: capabilities come from the **persona**
 * (what this kind of worker is for) and trust comes from the **Contact** (what
 * this repository is allowed to say to it). The same persona may be trusted on
 * one repo and not another, which is the argument domain.ts already makes for
 * `isolation`.
 */
export function capabilitiesFor(contact: Contact, persona: PersonaTemplate): ResolvedCapabilities {
  const workingPath = workingPathFor(contact)
  const trust = repoTrustOf(contact.repoTrust)

  const mcpServers: ResolvedMcpServer[] = []
  const unavailable: UnavailableServer[] = []

  if (persona.mcpServerIds.includes(GITHUB_MCP_SERVER_ID)) {
    const token = getGitHubStatus().connected ? getGitHubToken() : null
    if (token) {
      mcpServers.push({
        id: GITHUB_MCP_SERVER_ID,
        // The scope decides the endpoint, so the narrowing is enforced by
        // GitHub before any of our own code runs.
        url: githubMcpEndpoint(persona.githubScope),
        token,
        tokenEnvVar: GITHUB_MCP_TOKEN_ENV,
        deniedTools: githubMcpDenyList(persona.githubScope),
        disallowedTools: githubMcpDisallowedTools(persona.githubScope)
      })
    } else {
      unavailable.push({
        id: GITHUB_MCP_SERVER_ID,
        reason: 'GitHub is not connected, so its tools are unavailable this turn.'
      })
    }
  }

  const approved = new Set(trust.skills)
  const repoSkills = discoverRepoSkills(workingPath).filter((skill) => approved.has(skill.name))

  // On Codex, an approved skill is native when Codex would find it anyway —
  // the seal simply stops disabling it, and the model gets real progressive
  // disclosure and real invocation. Everything else has to be injected. Claude
  // injects all of them, because opening its discovery would mean opening
  // `.claude/settings.json` and its permission grants along with it.
  //
  // Splitting here rather than in the adapters is what lets one checkbox mean
  // the same thing on both backends: the user approves a skill, and this
  // decides the delivery.
  const codexDiscoverable =
    persona.backend === 'codex' ? new Set(discoverCodexSkills(workingPath)) : new Set<string>()

  const nativeSkillNames: string[] = []
  const injectedSkills: RepoSkill[] = []
  for (const skill of repoSkills) {
    if (skill.codexNative && codexDiscoverable.has(skill.name)) {
      nativeSkillNames.push(skill.name)
    } else {
      injectedSkills.push(skill)
    }
  }

  return {
    mcpServers,
    unavailable,
    repoInstructions: trust.instructions ? readRepoInstructions(workingPath) : null,
    nativeSkillNames,
    injectedSkills
  }
}
