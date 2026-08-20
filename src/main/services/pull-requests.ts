import { and, desc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { groupMessages } from '../db/schema'
import { recordAuditEvent, type AuditActor } from './audit-events'
import { getContact } from './contacts'
import {
  commitSubjects,
  currentBranch,
  dirtyFiles,
  githubSlug,
  isGitRepo,
  originUrl,
  pushBranch
} from './git'
import { getGitHubToken, missingTokenError } from './github-auth'
import { gitHubClient } from './github-client'
import { getPersonaTemplate } from './persona-templates'
import { workingPathFor } from './run-lock'
import type { PrRef } from './github-client'
import type { Contact, PersonaTemplate } from '../../shared/domain'

/**
 * Opening a pull request (blueprint §9.2, §16 Journey 3).
 *
 * The whole point of routing this through the app rather than letting a persona
 * shell out is that every one of these steps is a decision somebody should be
 * able to read afterwards. So the refusals are the design, not the error
 * handling: each check below names what is wrong and what to do about it, and
 * each of them is reachable — an agent leaves uncommitted work, a Contact is
 * bound to a folder that is not a repo, a persona is `read_only`.
 *
 * **`githubScope` is enforced here, not in the button.** `OpenPRButton` hides
 * itself for `read_only`, which is the right thing for a UI to do and worth
 * nothing on its own: the procedure behind it is callable regardless. Blueprint
 * §13 is clear that this is "a permission label on the persona, not hard-enforced
 * beyond what the token itself allows" — the app's job is to have exactly one
 * gate and to put it where the action happens.
 *
 * **PR state is not stored.** GitHub already knows whether a branch has an open
 * pull request, and asking it cannot go stale, get orphaned by a branch deleted
 * elsewhere, or need a migration. `pullRequestState` is a read, cached by the
 * renderer's query client rather than by a table.
 */

export type PrAction = 'created' | 'commented'

export interface PrResult extends PrRef {
  action: PrAction
}

export interface PrState {
  /**
   * Whether this Contact has any pull-request path at all: a git repo, a GitHub
   * remote, a branch of its own, and a persona allowed to write. The action is
   * hidden rather than disabled when false — a plain folder has no PR to offer.
   */
  available: boolean
  pr: PrRef | null
}

/** Everything the checks below need, resolved once. */
interface PrContext {
  contact: Contact
  persona: PersonaTemplate
  workingPath: string
  branch: string
  owner: string
  repo: string
  token: string
}

export async function pullRequestState(contactId: string): Promise<PrState> {
  const context = await resolve(contactId).catch(() => null)
  if (!context) return { available: false, pr: null }

  const { owner, repo, branch, token } = context
  // A failure here is a background read nobody asked for — a revoked token or a
  // dropped connection surfaces properly when the user clicks, with the message
  // written for it, rather than as an error next to a button they never used.
  const pr = await gitHubClient(token)
    .findOpenPr(owner, repo, branch)
    .catch(() => null)

  return { available: true, pr }
}

/**
 * Pushes the Contact's branch and opens a pull request for it — or, when one is
 * already open, comments on it.
 *
 * The second case is the one that makes this usable more than once. A persona
 * asked to address review feedback pushes more commits to the same branch; a
 * second `createPr` would fail with GitHub's own 422, and opening a duplicate
 * would be worse. Commenting says what changed, on the thread where the
 * conversation already is.
 */
export async function openPullRequest(contactId: string, actor?: AuditActor): Promise<PrResult> {
  const context = await resolve(contactId)
  const { contact, workingPath, branch, owner, repo, token } = context
  const client = gitHubClient(token)

  const { defaultBranch, canPush } = await client.getRepo(owner, repo)

  if (branch === defaultBranch) {
    throw new Error(
      `${contact.displayName} works directly on ${defaultBranch}, so there is no branch to open a pull request from. ` +
        'Give it a worktree of its own, or check out a branch in that directory.'
    )
  }
  if (!canPush) {
    throw new Error(
      `The stored GitHub token cannot push to ${owner}/${repo}, so a pull request cannot be opened from here.`
    )
  }

  // Deliberately not "commit it for them". The app has never authored a commit,
  // and the first one it authored should not be an unattended one made of work
  // nobody has read — see docs/plan/09-github-remote-actions.md.
  const dirty = await dirtyFiles(workingPath)
  if (dirty.length > 0) {
    throw new Error(
      `${contact.displayName} left ${describeCount(dirty.length, 'uncommitted change')} in its working copy ` +
        `(${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', …' : ''}). ` +
        'Only committed work can be pushed — commit or discard them first.'
    )
  }

  const commits = await commitSubjects(contact.repoPath, defaultBranch, branch)
  if (commits?.length === 0) {
    throw new Error(
      `${branch} has no commits that ${defaultBranch} does not already have, so there is nothing to open a pull request about.`
    )
  }

  // https rather than whatever `origin` happens to be: an ssh remote would need
  // a key the app knows nothing about, and a remote left behind by another tool
  // may carry its own stale credential.
  await pushBranch(workingPath, branch, `https://github.com/${owner}/${repo}.git`, token)

  const summary = latestSummary(contact.id, branch)
  const existing = await client.findOpenPr(owner, repo, branch)

  const auditPr = (result: PrResult): PrResult => {
    recordAuditEvent({
      action: 'pull_request_opened',
      actor,
      contactId: contact.id,
      repoPath: contact.repoPath,
      personaTemplateId: contact.personaTemplateId,
      summary:
        result.action === 'created'
          ? `Opened pull request #${result.number} from ${contact.displayName}`
          : `Commented on pull request #${result.number} from ${contact.displayName}`,
      metadata: { prNumber: result.number, prUrl: result.url, prAction: result.action }
    })
    return result
  }

  if (existing) {
    await client.comment(owner, repo, existing.number, updateBody(context, commits, summary))
    return auditPr({ ...existing, action: 'commented' })
  }

  const created = await client.createPr({
    owner,
    repo,
    head: branch,
    base: defaultBranch,
    title: titleFor(context, commits, summary),
    body: openingBody(context, commits, summary)
  })

  return auditPr({ ...created, action: 'created' })
}

/**
 * The checks that are about *whether this Contact has a pull-request path at
 * all*, as opposed to whether this particular attempt can go ahead.
 *
 * Split out because `pullRequestState` needs exactly these and none of the
 * others: they decide whether the action is offered, and the rest decide whether
 * it succeeds. The scope check lives here rather than with the others precisely
 * so a `read_only` persona has no action to click in the first place.
 */
async function resolve(contactId: string): Promise<PrContext> {
  const contact = getContact(contactId)
  if (!contact) throw new Error(`No such contact: ${contactId}`)

  const persona = getPersonaTemplate(contact.personaTemplateId)
  if (!persona) throw new Error(`No such persona template: ${contact.personaTemplateId}`)

  if (persona.githubScope === 'read_only') {
    throw new Error(
      `${persona.name} has a read_only GitHub scope, so it cannot open pull requests. ` +
        'Change the persona’s GitHub scope to open_pr to allow it.'
    )
  }

  const token = getGitHubToken()
  if (!token) throw missingTokenError('open a pull request')

  const workingPath = workingPathFor(contact)
  if (!(await isGitRepo(workingPath))) {
    throw new Error(
      `${contact.displayName} is bound to a folder that is not a git repository, so it has nothing to open a pull request from.`
    )
  }

  const branch = await currentBranch(workingPath)
  if (!branch) {
    throw new Error(`${contact.displayName}'s working copy is not on a branch.`)
  }

  const remote = await originUrl(contact.repoPath)
  const slug = remote ? githubSlug(remote) : null
  if (!slug) {
    throw new Error(
      `${contact.displayName}'s repository has no GitHub remote, so there is nowhere to open a pull request.`
    )
  }

  return { contact, persona, workingPath, branch, owner: slug.owner, repo: slug.repo, token }
}

// --- What the pull request says ----------------------------------------------

/**
 * The Contact's most recent end-of-session summary for this branch.
 *
 * Phase 7 already writes one per turn, so the PR body can say why the work
 * happened rather than only what changed — and it is the persona's own account
 * of it, not a paraphrase assembled from commit subjects. Null is normal: a
 * summariser call can fail, and the PR is still worth opening.
 */
function latestSummary(contactId: string, branch: string): string | null {
  const row = initDb()
    .select({ content: groupMessages.content })
    .from(groupMessages)
    .where(
      and(
        eq(groupMessages.contactId, contactId),
        eq(groupMessages.branch, branch),
        eq(groupMessages.type, 'system_summary')
      )
    )
    .orderBy(desc(groupMessages.timestamp))
    .get()

  return row?.content ?? null
}

const TITLE_MAX = 72

function titleFor(
  { contact, branch }: PrContext,
  commits: string[] | null,
  summary: string | null
): string {
  // One commit is overwhelmingly the common case, and its subject is a better
  // title than anything derived: the persona wrote it about this exact change.
  if (commits?.length === 1) return truncate(commits[0], TITLE_MAX)
  if (summary) return truncate(firstSentence(summary), TITLE_MAX)
  // `branch` is what was actually pushed (read from the working copy's HEAD),
  // not the row's registered name — the live Phase 11 run watched those
  // diverge and the title name a branch the PR did not ship (F5).
  return truncate(`${contact.displayName}: changes on ${branch}`, TITLE_MAX)
}

function openingBody(context: PrContext, commits: string[] | null, summary: string | null): string {
  const { contact, persona, branch } = context

  return [
    `Opened by **${contact.displayName}** from Switchboard.`,
    summary ? `> ${summary.replace(/\n+/g, '\n> ')}` : null,
    commitList(commits),
    `<sub>Persona: ${persona.name} · backend: ${persona.backend} · sandbox: ${persona.sandbox} · ` +
      `GitHub scope: ${persona.githubScope} · branch: \`${branch}\`</sub>`
  ]
    .filter(Boolean)
    .join('\n\n')
}

function updateBody(context: PrContext, commits: string[] | null, summary: string | null): string {
  return [
    `**${context.contact.displayName}** pushed more work to \`${context.branch}\`.`,
    summary ? `> ${summary.replace(/\n+/g, '\n> ')}` : null,
    commitList(commits)
  ]
    .filter(Boolean)
    .join('\n\n')
}

function commitList(commits: string[] | null): string | null {
  if (!commits || commits.length === 0) return null
  return ['**Commits**', ...commits.map((subject) => `- ${subject}`)].join('\n')
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = trimmed.search(/[.!?](\s|$)/)
  return end === -1 ? trimmed : trimmed.slice(0, end + 1)
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

function describeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
