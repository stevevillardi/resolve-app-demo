import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * What a repository has to say for itself — read by the app, on purpose.
 *
 * Both backends can find these files by themselves, and this app stops them:
 * Claude gets `settingSources: []`, Codex gets `project_doc_max_bytes: 0` and
 * every discovered skill disabled by name. That seal is the default and it
 * stays the default. This module exists so a *human* can lift it for one
 * Contact at a time, which needs the bytes in our hands rather than the
 * backend's — that is the one thing reading it ourselves buys outright, and it
 * is what lets the opt-in dialog show the text before anybody accepts it.
 *
 * In services/ rather than adapters/ because it touches the filesystem of a
 * particular machine (adapters/types.ts). Synchronous throughout, matching
 * worktrees.ts:refHead() and secrets.ts:getSecret(): a missing file is the
 * common case, not an error, and every read degrades to null rather than
 * throwing.
 */

/**
 * 32 KB. Large enough for any instructions file written for a human to read —
 * this repo's own CLAUDE.md is under 5 KB — and small enough that a generated
 * or accidentally-committed monster cannot displace the persona's own prompt in
 * the context window.
 */
export const REPO_INSTRUCTIONS_MAX_BYTES = 32 * 1024

/**
 * Checked in this order. A repo shipping both with identical content — the
 * common case, one file for each tool's convention — is read once and named by
 * the first. Two files that genuinely differ are BOTH read, concatenated under
 * headers (doc 15 item 6): the first-hit-wins rule this replaced silently
 * dropped whichever file lost, and a repo whose two files disagree is exactly
 * the repo whose second file matters.
 */
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'] as const

/**
 * Repo-local skill roots. Never $CODEX_HOME — see discoverRepoSkills().
 *
 * Codex-discoverable roots first, because the first root wins a name collision
 * and a repo shipping the same skill under two conventions should get the
 * better delivery mechanism: native invocation on Codex rather than an injected
 * catalogue entry. On Claude the order is immaterial — everything is injected.
 */
const SKILL_ROOTS = ['.codex/skills', '.agents/skills', '.claude/skills'] as const

/** Roots Codex discovers natively. The rest can only be delivered by injection. */
const CODEX_NATIVE_ROOTS = new Set(['.codex/skills', '.agents/skills'])

export interface RepoInstructions {
  /** Which file this came from, so the prompt can say where it is from. */
  fileName: string
  /** Absolute path, for the approval dialog. */
  path: string
  /** The text, truncated to REPO_INSTRUCTIONS_MAX_BYTES if it was over. */
  content: string
  truncated: boolean
}

export interface RepoSkill {
  /** The directory name, which is what both backends key a skill on. */
  name: string
  /** From frontmatter; empty when the file has none we could read. */
  description: string
  /** Absolute path to the SKILL.md, which is what an injected catalogue cites. */
  path: string
  /** Which root it was found under, e.g. `.codex/skills`. */
  root: string
  /**
   * Whether Codex would discover this one by itself. A `.claude/skills` entry
   * is invisible to Codex however it is configured, so approving it can only be
   * honoured by injecting a catalogue entry — see capabilities.ts, which is
   * where that split becomes two different pieces of backend configuration.
   */
  codexNative: boolean
}

/**
 * The repo's own instructions, or null when it ships none.
 *
 * Truncation is stated in the returned text rather than applied silently. A
 * model handed the first 32 KB of a 40 KB document with no indication will
 * follow half a sentence and act as though it read the whole thing; one line
 * saying otherwise costs nothing and is the difference between a cap and a
 * corruption.
 *
 * Not resolved: `@path` imports, which CLAUDE.md supports and which would mean
 * following references out of the file we showed the user for approval. That is
 * a deliberate omission, recorded in docs/plan/14-agent-capability-surface.md.
 */
export function readRepoInstructions(workingPath: string): RepoInstructions | null {
  const found: { fileName: string; path: string; raw: string }[] = []
  for (const fileName of INSTRUCTION_FILES) {
    const path = join(workingPath, fileName)
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    if (raw.trim() === '') continue
    found.push({ fileName, path, raw })
  }

  if (found.length === 0) return null

  // Identical content shipped twice for two tools' conventions: one read,
  // named by the preferred file.
  const distinct =
    found.length === 2 && found[0].raw.trim() === found[1].raw.trim() ? [found[0]] : found

  const fileName = distinct.map((file) => file.fileName).join(' + ')
  const raw =
    distinct.length === 1
      ? distinct[0].raw
      : distinct.map((file) => `## ${file.fileName}\n\n${file.raw.trim()}`).join('\n\n')

  // One shared cap, whether the text came from one file or two — the cap
  // exists to protect the persona's own prompt, which does not care how many
  // files the excess arrived in.
  const truncated = Buffer.byteLength(raw, 'utf8') > REPO_INSTRUCTIONS_MAX_BYTES
  const content = truncated
    ? `${raw.slice(0, REPO_INSTRUCTIONS_MAX_BYTES)}\n\n[Truncated: ${fileName} is longer than ${REPO_INSTRUCTIONS_MAX_BYTES} bytes and was cut off here.]`
    : raw

  // `path` stays the first file's — it feeds the approval dialog, which shows
  // `content` itself, so the path is a pointer rather than the evidence.
  return { fileName, path: distinct[0].path, content, truncated }
}

/**
 * Every skill this repository ships, whichever convention it used.
 *
 * Repo-local only. This is deliberately *not* discoverCodexSkills() in
 * codex.ts, which also enumerates `$CODEX_HOME/skills` — that function builds
 * the **seal** list, where the requirement is to name everything Codex might
 * find so it can all be disabled. This one builds the **offer** list, shown to
 * a human under a heading reading "what this repository asks for". Putting the
 * user's own machine-global skills under that heading would be a lie, so the
 * two lists are separate on purpose and neither is derivable from the other.
 */
export function discoverRepoSkills(workingPath: string): RepoSkill[] {
  const found = new Map<string, RepoSkill>()

  for (const root of SKILL_ROOTS) {
    const dir = join(workingPath, root)
    let entries: string[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
    } catch {
      // A root that does not exist is the common case, not an error.
      continue
    }

    for (const name of entries) {
      const path = join(dir, name, 'SKILL.md')
      if (!existsSync(path)) continue
      // First root wins, in SKILL_ROOTS order, so a repo shipping the same
      // skill twice offers one checkbox rather than two that disagree — and
      // the one it offers is the natively-discoverable copy.
      if (found.has(name)) continue

      found.set(name, {
        name,
        description: descriptionOf(path),
        path,
        root,
        codexNative: CODEX_NATIVE_ROOTS.has(root)
      })
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The `description:` line from a SKILL.md's frontmatter.
 *
 * A hand-rolled scanner rather than a YAML dependency, because `name` and
 * `description` are the only keys either backend requires of a skill and this
 * repo does not add a dependency for a job this size. Malformed frontmatter
 * degrades to an empty description; the skill still appears, because the thing
 * that makes it usable is the directory name and the file on disk, neither of
 * which the frontmatter affects.
 */
function descriptionOf(skillPath: string): string {
  let raw: string
  try {
    raw = readFileSync(skillPath, 'utf8')
  } catch {
    return ''
  }

  const lines = raw.split('\n')
  if (lines[0]?.trim() !== '---') return ''

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') break
    const match = /^description:\s*(.*)$/.exec(line)
    if (!match) continue
    // Strip one layer of quoting, which is the only YAML nicety worth honouring
    // here — a folded or multi-line description is beyond what a scanner should
    // pretend to read, and returning its first line is better than guessing.
    return match[1].trim().replace(/^["'](.*)["']$/, '$1')
  }
  return ''
}
