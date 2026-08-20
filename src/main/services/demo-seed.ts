import { notInArray } from 'drizzle-orm'
import { initDb } from '../db'
import {
  appState,
  contacts,
  groupMessages,
  groups,
  messages,
  personaTemplates,
  routines,
  skills,
  toolCalls,
  usageEvents
} from '../db/schema'
import { SEED_PERSONA_TEMPLATES, SEED_SKILLS } from '../db/seed-data'
import type { AppStateKey } from './app-state'

/**
 * The rows behind `npm run demo` (see demo-profile.ts for the flag and the
 * git side): a profile that looks like Switchboard has been used for two weeks
 * to build Switchboard itself, so a walkthrough has something real-looking on
 * every screen — threads with tool calls and work chips, a group per repo with
 * all five message shapes, routines with history (enabled, missed, and
 * disabled), a fortnight of spend, unread badges, and an interrupted turn with
 * its Retry affordance.
 *
 * Everything here is data, written straight into the tables the way the
 * screenshot sweep's seeder does (e2e/screenshots/showcase.ts) and for the
 * same reason: no turn ever runs, so staging costs nothing and needs no
 * credentials. The stories the threads tell are lifted from this repository's
 * own history (the draft-eating lock refusal, the `sed -ni` sandbox bypass,
 * the FTS snapshot re-chain) — fiction closest to the truth reads best on a
 * projector, and a live turn during the demo can actually be asked about them.
 *
 * Split from demo-profile.ts so this half imports neither `electron` nor git:
 * it is a pure function of the database and a layout of paths the orchestrator
 * (or a test) hands in, which is what makes its claims testable against
 * createTestDb.
 */

/**
 * App-state keys that survive the wipe: identity and machine configuration,
 * never content. GitHub state stays because reconnecting a device-flow token
 * live in a meeting is nobody's favourite demo; the backend logins are not
 * even ours to lose (they live in the OS keychain and ~/.claude / ~/.codex,
 * which nothing here touches).
 */
export const PRESERVED_APP_STATE: AppStateKey[] = [
  'github_account_login',
  'github_scopes',
  'github_token_state',
  'workspace_root',
  'notifications_enabled'
]

/**
 * Empties every content table, keeping only the preserved app-state keys.
 *
 * Deletion order is FK order. Contacts normally go first through
 * deleteContact() (the orchestrator does that, so real repos' worktree
 * registrations are cleaned by the same path a user's delete takes); this
 * sweep is what makes the wipe total regardless — including rows whose
 * contact was already gone (usage events, orphaned group history).
 */
export function wipeForDemo(): void {
  initDb().transaction((tx) => {
    tx.delete(toolCalls).run()
    tx.delete(messages).run()
    tx.delete(routines).run()
    tx.delete(groupMessages).run()
    tx.delete(usageEvents).run()
    tx.delete(contacts).run()
    tx.delete(groups).run()
    tx.delete(personaTemplates).run()
    tx.delete(skills).run()
    tx.delete(appState).where(notInArray(appState.key, PRESERVED_APP_STATE)).run()
  })
}

export interface DemoContactIds {
  reviewer: string
  hunter: string
  tester: string
  docs: string
  refactor: string
  release: string
}

export interface DemoLayout {
  now: number
  /** The Switchboard checkout itself, or the stand-in the orchestrator built. */
  appRepo: string
  /** The scratch marketing-site repo, always fabricated. */
  siteRepo: string
  ids: DemoContactIds
  /** Materialised by the orchestrator: a real branch with a real commit. */
  refactor: { path: string; branch: string; headBefore: string | null; headAfter: string | null }
  /** Planned only — the worktree appears on the first live writing turn. */
  tester: { path: string; branch: string }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The starter-catalog personas the demo installs — one per Chats row. */
const DEMO_PERSONA_IDS = [
  'persona-code-reviewer',
  'persona-bug-hunter',
  'persona-test-author',
  'persona-docs-writer',
  'persona-refactor-buddy',
  'persona-release-manager'
]

export function seedDemoData(layout: DemoLayout): void {
  const { now, appRepo, siteRepo, ids } = layout
  const appName = basename(appRepo)
  const siteName = basename(siteRepo)

  const catalogPersonas = SEED_PERSONA_TEMPLATES.filter((p) => DEMO_PERSONA_IDS.includes(p.id))
  // Every skill an installed persona attaches must exist, or the persona
  // editor would claim instructions the composer cannot inject.
  const wantedSkillIds = new Set(catalogPersonas.flatMap((p) => p.skillIds))
  const catalogSkills = SEED_SKILLS.filter(
    (s) => wantedSkillIds.has(s.id) || ['skill-api-design', 'skill-test-coverage'].includes(s.id)
  )

  const personaOf = (contactId: string): string => {
    const pairs: [string, string][] = [
      [ids.reviewer, 'persona-code-reviewer'],
      [ids.hunter, 'persona-bug-hunter'],
      [ids.tester, 'persona-test-author'],
      [ids.docs, 'persona-docs-writer'],
      [ids.refactor, 'persona-refactor-buddy'],
      [ids.release, 'persona-release-manager']
    ]
    return pairs.find(([id]) => id === contactId)?.[1] as string
  }

  initDb().transaction((tx) => {
    for (const skill of catalogSkills) tx.insert(skills).values(skill).run()
    for (const persona of catalogPersonas) tx.insert(personaTemplates).values(persona).run()

    // --- App-level state -------------------------------------------------
    // seed_version so seedIfNeeded() stays a no-op after this; onboarding so
    // the walkthrough opens on the shell, not the wizard. The budget sits just
    // under the fortnight's priced spend, with one unpriced turn in the month,
    // so Home shows the crossed-budget banner in its honest "at least" form.
    const state: [AppStateKey, string][] = [
      ['seed_version', '1'],
      ['onboarding_completed', 'true'],
      ['monthly_budget_usd', '10']
    ]
    for (const [key, value] of state) {
      tx.insert(appState)
        .values({ key, value })
        .onConflictDoUpdate({ target: appState.key, set: { value } })
        .run()
    }

    // --- Groups (one per repo, same invariant ensureGroupForRepo keeps) ---
    tx.insert(groups)
      .values([
        // Backdated boundary: the mention exchange and the durable decision
        // below land after it, so the group row wears an unread badge.
        { id: 'demo-group-app', repoPath: appRepo, lastReadAt: new Date(now - 27 * HOUR) },
        { id: 'demo-group-site', repoPath: siteRepo, lastReadAt: new Date(now) }
      ])
      .run()

    // --- Contacts ---------------------------------------------------------
    const contact = (
      id: string,
      repoPath: string,
      displayName: string,
      extra: Partial<typeof contacts.$inferInsert> = {}
    ): typeof contacts.$inferInsert => ({
      id,
      personaTemplateId: personaOf(id),
      repoPath,
      displayName,
      backendSessionId: null,
      isolation: 'shared',
      lastReadAt: new Date(now),
      ...extra
    })

    tx.insert(contacts)
      .values([
        contact(ids.reviewer, appRepo, `Code Reviewer · ${appName}`, {
          // Before the thread's last assistant reply: one unread, one badge,
          // and the "New messages" divider inside the thread.
          lastReadAt: new Date(now - 25 * MINUTE)
        }),
        contact(ids.hunter, appRepo, `Bug Hunter · ${appName}`),
        contact(ids.tester, appRepo, `Test Author · ${appName}`, {
          isolation: 'worktree',
          worktreePath: layout.tester.path,
          branch: layout.tester.branch
        }),
        contact(ids.docs, appRepo, `Docs Writer · ${appName}`, {
          // The one contact that has been granted anything by its repo, so the
          // "works with" panel has both a sealed state and a granted one to show.
          repoTrust: { instructions: true, skills: [] }
        }),
        contact(ids.refactor, siteRepo, `Refactor Buddy · ${siteName}`, {
          isolation: 'worktree',
          worktreePath: layout.refactor.path,
          branch: layout.refactor.branch
        }),
        contact(ids.release, siteRepo, `Release Manager · ${siteName}`)
      ])
      .run()

    // --- 1:1 threads ------------------------------------------------------
    type Row = typeof messages.$inferInsert
    const rows: Row[] = []
    const say = (
      id: string,
      contactId: string,
      role: 'user' | 'assistant',
      at: number,
      content: string,
      work?: Row['work']
    ): void => {
      rows.push({
        id,
        contactId,
        role,
        content,
        timestamp: new Date(at),
        ...(work ? { work } : {})
      })
    }

    // Code Reviewer — the lock refusal that ate drafts, and the rule that
    // ended it: the composer clears only on an accepted send.
    say(
      'demo-m-01',
      ids.reviewer,
      'user',
      now - 2 * DAY - 5 * HOUR,
      'Something is eating drafts. If a persona is mid-turn and I send again, the send is refused — fine — but the whole message I typed vanishes with the refusal. Can you find where?'
    )
    say(
      'demo-m-02',
      ids.reviewer,
      'assistant',
      now - 2 * DAY - 5 * HOUR + 2 * MINUTE,
      "Found it. `Composer.handleSend` clears the textarea synchronously, before the IPC resolves:\n\n```tsx\nconst handleSend = () => {\n  onSend?.(value.trim())\n  setValue('') // <- fires whether or not the send was accepted\n}\n```\n\nThe lock refusal throws in `messages.send`, but by then the draft is already gone. The composer is deciding something only the owner of the mutation can know — whether the send was *accepted*.\n\nSeverity: should fix. It turns a safety refusal into data loss, which teaches people to fight the lock instead of trusting it."
    )
    say(
      'demo-m-03',
      ids.reviewer,
      'user',
      now - 26 * HOUR,
      'Is the fix just moving the clear into the mutation success handler?'
    )
    say(
      'demo-m-04',
      ids.reviewer,
      'assistant',
      now - 26 * HOUR + 90_000,
      'Yes — clear-on-success, and specifically not restore-on-error. A restore would clobber whatever was typed while the IPC was in flight; clearing only when the send is accepted has no such race. The composer stops clearing itself entirely and the thread view clears in a per-call `onSuccess`.'
    )
    say(
      'demo-m-05',
      ids.reviewer,
      'user',
      now - 35 * MINUTE,
      'That landed in the last round of work. Can you double-check the group thread got the same treatment?'
    )
    say(
      'demo-m-06',
      ids.reviewer,
      'assistant',
      now - 20 * MINUTE,
      "It did. `GroupThreadView` moves its `setDraft('')` into the mention mutation's `onSuccess`, same as the 1:1 view — and both views are now keyed by conversation id, which also ends the draft bleeding you would otherwise get when switching between a contact and its group.\n\nLooks correct. Nothing to fix here."
    )

    // Bug Hunter — the sandbox guard that read the command instead of running it.
    say(
      'demo-m-07',
      ids.hunter,
      'user',
      now - 26 * HOUR - 40 * MINUTE,
      'The sandbox test suite claims it rejects `sed -i`. Assume the test is lying and try to get around the guard.'
    )
    say(
      'demo-m-08',
      ids.hunter,
      'assistant',
      now - 26 * HOUR - 36 * MINUTE,
      "Reproduced a bypass. The guard matches the flag token `-i` exactly, so the clustered form walks straight through:\n\n```\nsed -ni 's/x/y/w /tmp/out' file   # -n and -i in one cluster\n```\n\nThat reaches the write path with the sandbox convinced it is a read. Trigger is concrete: any flag cluster containing `i`. The test named \"rejects sed -i\" passes because it only ever feeds the guard the spaced form — it tests the test's idea of the command, not the command.\n\nRoot cause: the guard parses flags with `===` instead of expanding clusters. Fix shape: split clustered short flags before matching, and make the *test* execute the guard against the clustered form so this cannot regress silently."
    )
    say(
      'demo-m-09',
      ids.hunter,
      'user',
      now - 26 * HOUR - 30 * MINUTE,
      'Good. File it in the group so it does not get lost, and check the other in-place editors while you are there.'
    )
    say(
      'demo-m-10',
      ids.hunter,
      'assistant',
      now - 26 * HOUR - 26 * MINUTE,
      'Posted to the group as a durable decision. Also traced `tee`, `dd of=`, and `sponge` through the same guard — all three are caught by the write-path check, so the cluster expansion is the only gap I could construct. Paths I attacked and found holding: redirection operators, `xargs` indirection, `find -exec`.'
    )

    // Test Author — tests written from the claim, for the FTS query builder.
    say(
      'demo-m-11',
      ids.tester,
      'user',
      now - 8 * HOUR,
      'Cover `buildMatchQuery` — the FTS5 quoting. I care most about raw metacharacters and a typed AND not becoming an operator.'
    )
    say(
      'demo-m-12',
      ids.tester,
      'assistant',
      now - 8 * HOUR + 4 * MINUTE,
      'Ten tests written, all from the claims the function makes rather than its code:\n\n- every term is double-quoted, so `AND`, `NEAR`, `*` and `-` arrive as words, not operators\n- embedded quotes are doubled, so a term containing `"` cannot close the string\n- only the last term gets the prefix star, so typing mid-word matches without flooding earlier terms\n- the empty and whitespace-only inputs return a query that matches nothing rather than throwing\n\nI verified two of them by mutation — removed the quote-doubling and watched the injection test go red before restoring it. The suite passes; the mutation check is in the test names so the next reader knows it was done.'
    )

    // Docs Writer — an interrupted turn: trailing user row, orphaned tool call.
    say(
      'demo-m-13',
      ids.docs,
      'user',
      now - DAY - 2 * HOUR,
      'The README still calls the app by its old name in a couple of places.'
    )
    say(
      'demo-m-14',
      ids.docs,
      'assistant',
      now - DAY - 2 * HOUR + 50_000,
      'Fixed — two occurrences, one in the install section and one under the screenshot. I also checked the tray tooltip copy against `tray.ts` while I was in there; the code and the README now agree on "Switchboard" everywhere. The docs change is staged in the working tree, nothing committed.'
    )
    say(
      'demo-m-15',
      ids.docs,
      'user',
      now - 45 * MINUTE,
      'Add @file autocomplete and the ⌘K message search to the feature list, and mention that a failed turn can be retried in place.'
    )

    // Refactor Buddy — the one thread whose work chip is backed by a real branch.
    say(
      'demo-m-16',
      ids.refactor,
      'user',
      now - 6 * HOUR,
      'The spacing in `styles.css` is ad hoc — I count four different gutter values. Consolidate onto one scale.'
    )
    say(
      'demo-m-17',
      ids.refactor,
      'assistant',
      now - 6 * HOUR + 5 * MINUTE,
      'Done, in one behavior-preserving step. The four gutters (14px, 18px, 22px, 28px) collapse onto an 8px scale — `--space-2` through `--space-4` — chosen so every existing value rounds to its nearest step and nothing moves more than 2px. The commit is on my branch; `index.html` has an uncommitted follow-up swapping the last inline margin for the token, which I left for you to look at before it lands.',
      {
        branch: layout.refactor.branch,
        headBefore: layout.refactor.headBefore,
        headAfter: layout.refactor.headAfter,
        committed: ['styles.css'],
        dirty: ['index.html']
      }
    )

    // Release Manager — a verdict with evidence.
    say(
      'demo-m-18',
      ids.release,
      'user',
      now - 2 * DAY - HOUR,
      'Where are we on cutting 0.1 of the site?'
    )
    say(
      'demo-m-19',
      ids.release,
      'assistant',
      now - 2 * DAY - HOUR + 2 * MINUTE,
      '**Ship with named risks.**\n\nGates: content review green, links checked on the exact candidate commit, analytics config pinned. One gate waived: the copy deck\'s pricing section is still marked draft — risk is a public page saying "TBD", mitigation is shipping with that section behind the fold. Rollback is redeploying the previous build; nothing to un-migrate.\n\nChangelog entry drafted: "The site now loads in under a second on a cold cache — images are sized and lazy."'
    )

    tx.insert(messages).values(rows).run()

    // --- Tool calls: timelines under the replies, plus one orphan ---------
    const call = (
      id: string,
      contactId: string,
      messageId: string | null,
      name: string,
      status: 'completed' | 'failed',
      at: number,
      detail: string,
      output: string | null
    ): typeof toolCalls.$inferInsert => ({
      id,
      contactId,
      messageId,
      toolCallId: id,
      name,
      status,
      createdAt: new Date(at),
      detail,
      output
    })

    tx.insert(toolCalls)
      .values([
        call(
          'demo-tc-01',
          ids.reviewer,
          'demo-m-02',
          'Read',
          'completed',
          now - 2 * DAY - 5 * HOUR + MINUTE,
          'src/renderer/src/components/conversation/Composer.tsx',
          "228:  const handleSend = () => {\n229:    onSend?.(value.trim())\n230:    setValue('')"
        ),
        call(
          'demo-tc-02',
          ids.reviewer,
          'demo-m-02',
          'Grep',
          'completed',
          now - 2 * DAY - 5 * HOUR + MINUTE + 20_000,
          "setValue('') in src/renderer",
          '1 match — Composer.tsx:230'
        ),
        call(
          'demo-tc-03',
          ids.reviewer,
          'demo-m-06',
          'Read',
          'completed',
          now - 21 * MINUTE,
          'src/renderer/src/components/conversation/GroupThreadView.tsx',
          "312:      mention(target.contactId, draft, { onSuccess: () => setDraft('') })"
        ),
        call(
          'demo-tc-04',
          ids.hunter,
          'demo-m-08',
          'Bash',
          'completed',
          now - 26 * HOUR - 38 * MINUTE,
          "printf 'x\\n' > /tmp/probe && sed -ni 's/x/y/p;w /tmp/out' /tmp/probe && cat /tmp/out",
          'y — the write landed; the guard classified the command as a read'
        ),
        call(
          'demo-tc-05',
          ids.hunter,
          'demo-m-08',
          'Read',
          'completed',
          now - 26 * HOUR - 37 * MINUTE,
          'src/main/services/sandbox.test.ts',
          "84: it('rejects sed -i', () => {"
        ),
        call(
          'demo-tc-06',
          ids.tester,
          'demo-m-12',
          'Bash',
          'completed',
          now - 8 * HOUR + 3 * MINUTE,
          'npx vitest run src/main/services/search.test.ts',
          'Test Files  1 passed (1) · Tests  10 passed (10)'
        ),
        // The interrupted turn's orphan: still no message, swept to failed —
        // exactly what the boot reconciliation leaves behind after a crash.
        call('demo-tc-07', ids.docs, null, 'Read', 'failed', now - 44 * MINUTE, 'README.md', null),
        call(
          'demo-tc-08',
          ids.refactor,
          'demo-m-17',
          'Bash',
          'completed',
          now - 6 * HOUR + 3 * MINUTE,
          'rg -n "margin|padding" styles.css | sort -u',
          '14px ×6, 18px ×4, 22px ×3, 28px ×2 — four ad-hoc gutter values'
        )
      ])
      .run()

    // --- Group threads: all five message shapes between them --------------
    type GroupRow = typeof groupMessages.$inferInsert
    const groupRows: GroupRow[] = [
      {
        id: 'demo-g-01',
        groupId: 'demo-group-app',
        timestamp: new Date(now - 3 * DAY),
        type: 'routine_run',
        contactId: ids.reviewer,
        category: 'routine',
        durable: false,
        content:
          'Reviewed the overnight commits on main: the message-search migration and two composer fixes. Nothing needs a human — the migration ships its own backfill and the tests execute the claims they make.'
      },
      {
        id: 'demo-g-02',
        groupId: 'demo-group-app',
        timestamp: new Date(now - 26 * HOUR - 20 * MINUTE),
        type: 'user_mention',
        contactId: null,
        content:
          '@Bug Hunter file the sandbox finding here with the repro, so it survives the thread.'
      },
      {
        id: 'demo-g-03',
        groupId: 'demo-group-app',
        timestamp: new Date(now - 26 * HOUR - 18 * MINUTE),
        type: 'agent_reply',
        contactId: ids.hunter,
        content:
          "Filed. `sed -ni` reaches the write path — the guard matches `-i` as an exact token and never expands flag clusters. Repro: `sed -ni 's/x/y/w /tmp/out' file` under a read-only sandbox. `tee`, `dd`, and redirection are caught; the cluster is the only gap I could construct."
      },
      {
        id: 'demo-g-04',
        groupId: 'demo-group-app',
        timestamp: new Date(now - 26 * HOUR - 15 * MINUTE),
        type: 'system_summary',
        contactId: ids.hunter,
        category: 'decision',
        durable: true,
        content:
          'Sandbox guards must expand clustered short flags before matching, and their tests must execute the guarded command rather than read it — "rejects sed -i" passed for months while `sed -ni` walked through.'
      },
      {
        id: 'demo-g-05',
        groupId: 'demo-group-site',
        timestamp: new Date(now - 6 * HOUR + 8 * MINUTE),
        type: 'system_summary',
        contactId: ids.refactor,
        category: 'decision',
        durable: true,
        branch: layout.refactor.branch,
        content:
          'Collapsed four ad-hoc gutter values onto an 8px spacing scale (`--space-2`…`--space-4`), rounding each existing value to its nearest step so nothing moves more than 2px. Committed on the branch; one inline margin in `index.html` still uncommitted, left for review.'
      },
      {
        id: 'demo-g-06',
        groupId: 'demo-group-site',
        timestamp: new Date(now - 5 * HOUR),
        type: 'branch_request',
        contactId: ids.refactor,
        branch: layout.refactor.branch,
        content:
          'The spacing refactor is committed on my branch and the site renders identically at every breakpoint I checked. Merge it into the main checkout?'
      },
      {
        id: 'demo-g-07',
        groupId: 'demo-group-site',
        timestamp: new Date(now - 4 * HOUR),
        type: 'user_mention',
        contactId: null,
        content: '@Release Manager does the spacing change need a changelog entry?'
      },
      {
        id: 'demo-g-08',
        groupId: 'demo-group-site',
        timestamp: new Date(now - 4 * HOUR + MINUTE),
        type: 'agent_reply',
        contactId: ids.release,
        content:
          'No entry — a user cannot notice it, and a padded changelog is worse than a short one. It rides along in 0.1 as part of "visual polish" if anything ships alongside it that a user *can* see.'
      }
    ]
    tx.insert(groupMessages).values(groupRows).run()

    // --- Routines: one live and behind, two paused with history -----------
    tx.insert(routines)
      .values([
        {
          id: 'demo-r-01',
          contactId: ids.reviewer,
          schedule: '30 9 * * 1-5',
          enabled: true,
          prompt:
            'Review whatever landed on main overnight and post a summary to the group. Flag anything that needs a human; say plainly when nothing does.',
          lastRunAt: new Date(now - 3 * DAY),
          lastRunSummary: 'Reviewed the overnight commits on main; nothing needs a human.',
          // The laptop was closed for two weekday fires since that run.
          missedRunCount: 2,
          lastMissedAt: new Date(now - 26 * HOUR),
          monthlyBudgetUsd: 15
        },
        {
          id: 'demo-r-02',
          contactId: ids.release,
          schedule: '0 17 * * 5',
          enabled: false,
          prompt:
            "Run the release checklist against the week's build and post the verdict with evidence.",
          lastRunAt: new Date(now - 5 * DAY),
          lastRunSummary:
            'Ship with named risks: gates green except the pricing copy, which is still marked draft. Filed the risk in the group.',
          missedRunCount: 0,
          lastMissedAt: null,
          monthlyBudgetUsd: 10
        },
        {
          id: 'demo-r-03',
          contactId: ids.hunter,
          schedule: '0 */6 * * *',
          enabled: false,
          prompt:
            'Sweep the error paths that changed this week and try to construct a failing input for each.',
          lastRunAt: new Date(now - 3 * DAY - 2 * HOUR),
          lastRunSummary:
            'Swept the IPC error paths; no new findings. The worktree prune warning is still cosmetic.',
          missedRunCount: 0,
          lastMissedAt: null,
          monthlyBudgetUsd: null
        }
      ])
      .run()

    // --- A fortnight of spend ---------------------------------------------
    // Both backends, all four sources, a routine-attributed run, cache and
    // reasoning tokens, and one turn on a model with no published price so the
    // dashboard's "$x.xx+ / at least" honesty forms render.
    type Usage = typeof usageEvents.$inferInsert
    const usage: Usage[] = []
    let usageIndex = 0
    const spend = (
      contactId: string,
      at: number,
      source: Usage['source'],
      model: string,
      input: number,
      output: number,
      extra: Partial<Usage> = {}
    ): void => {
      usage.push({
        id: `demo-u-${String(++usageIndex).padStart(2, '0')}`,
        contactId,
        personaTemplateId: personaOf(contactId),
        repoPath: [ids.refactor, ids.release].includes(contactId) ? siteRepo : appRepo,
        timestamp: new Date(at),
        source,
        model,
        inputTokens: input,
        outputTokens: output,
        costSource: model.startsWith('claude') ? 'sdk' : 'computed',
        sessionId: `demo-session-${contactId.slice(0, 8)}`,
        ...extra
      })
    }

    spend(ids.reviewer, now - 13 * DAY, 'message', 'claude-sonnet-5', 14_200, 890, {
      cachedInputTokens: 6_000,
      costUsd: 0.31
    })
    spend(ids.reviewer, now - 11 * DAY, 'message', 'claude-sonnet-5', 22_800, 1_240, {
      cachedInputTokens: 15_000,
      costUsd: 0.47
    })
    spend(ids.hunter, now - 10 * DAY, 'message', 'gpt-5.5', 28_400, 2_310, {
      cachedInputTokens: 12_000,
      cacheWriteInputTokens: 4_100,
      reasoningOutputTokens: 1_800,
      costUsd: 0.83
    })
    spend(ids.tester, now - 9 * DAY, 'message', 'claude-sonnet-5', 19_600, 3_400, {
      cachedInputTokens: 9_800,
      costUsd: 0.62
    })
    spend(ids.reviewer, now - 8 * DAY, 'routine', 'claude-haiku-4-5', 8_900, 420, {
      routineId: 'demo-r-01',
      cachedInputTokens: 5_200,
      costUsd: 0.09
    })
    spend(ids.release, now - 7 * DAY, 'routine', 'claude-sonnet-5', 12_300, 980, {
      routineId: 'demo-r-02',
      cachedInputTokens: 7_400,
      costUsd: 0.28
    })
    spend(ids.docs, now - 6 * DAY, 'message', 'claude-haiku-4-5', 6_200, 1_150, {
      cachedInputTokens: 2_100,
      costUsd: 0.07
    })
    spend(ids.refactor, now - 5 * DAY, 'message', 'gpt-5.5', 34_100, 4_220, {
      cachedInputTokens: 18_000,
      cacheWriteInputTokens: 6_300,
      reasoningOutputTokens: 2_600,
      costUsd: 1.12
    })
    spend(ids.refactor, now - 5 * DAY + 10 * MINUTE, 'summary', 'gpt-5.4', 3_800, 240, {
      costUsd: 0.04
    })
    spend(ids.hunter, now - 3 * DAY - 2 * HOUR, 'routine', 'gpt-5.5', 15_700, 1_080, {
      routineId: 'demo-r-03',
      cachedInputTokens: 8_900,
      costUsd: 0.42
    })
    spend(ids.reviewer, now - 3 * DAY, 'routine', 'claude-haiku-4-5', 9_400, 380, {
      routineId: 'demo-r-01',
      cachedInputTokens: 6_100,
      costUsd: 0.09
    })
    spend(ids.release, now - 2 * DAY - HOUR, 'message', 'claude-opus-5', 16_900, 2_040, {
      cachedInputTokens: 8_200,
      costUsd: 1.94
    })
    spend(ids.hunter, now - 26 * HOUR, 'message', 'gpt-5.5', 41_300, 3_780, {
      cachedInputTokens: 22_000,
      cacheWriteInputTokens: 5_800,
      reasoningOutputTokens: 3_100,
      costUsd: 1.31
    })
    spend(ids.hunter, now - 26 * HOUR + 8 * MINUTE, 'mention', 'gpt-5.5', 9_800, 640, {
      cachedInputTokens: 4_400,
      costUsd: 0.24
    })
    spend(ids.hunter, now - 26 * HOUR + 12 * MINUTE, 'summary', 'gpt-5.4', 4_100, 280, {
      costUsd: 0.05
    })
    spend(ids.docs, now - DAY - 2 * HOUR, 'message', 'claude-sonnet-5', 11_600, 2_890, {
      cachedInputTokens: 5_500,
      costUsd: 0.44
    })
    // The unpriced turn: a model the price table has never heard of.
    spend(ids.reviewer, now - 26 * HOUR, 'message', 'claude-fable-5', 24_500, 1_960, {
      cachedInputTokens: 14_000,
      costUsd: null
    })
    spend(ids.tester, now - 8 * HOUR, 'message', 'claude-sonnet-5', 27_200, 5_110, {
      cachedInputTokens: 16_500,
      costUsd: 0.88
    })
    spend(ids.refactor, now - 6 * HOUR, 'message', 'gpt-5.5', 38_600, 6_040, {
      cachedInputTokens: 20_000,
      cacheWriteInputTokens: 7_200,
      reasoningOutputTokens: 4_400,
      costUsd: 1.47
    })
    spend(ids.reviewer, now - 20 * MINUTE, 'message', 'claude-sonnet-5', 31_400, 2_150, {
      cachedInputTokens: 24_000,
      costUsd: 0.58
    })

    tx.insert(usageEvents).values(usage).run()
  })
}

/** basename() without path's platform behaviour — same as worktrees.ts. */
function basename(value: string): string {
  const parts = value.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}
