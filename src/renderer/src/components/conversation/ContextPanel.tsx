import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { CheckRow } from '@/components/common/CheckRow'
import { EmptyState } from '@/components/common/EmptyState'
import { Section } from '@/components/common/Section'
import { CAPTION, StatTile } from '@/components/common/StatTile'
import { useContactContext, useRepoOffers, useSetRepoTrust } from '@/hooks/useConversations'
import { useUsageEvents } from '@/hooks/useUsage'
import {
  builtInNote,
  repoSkillChoices,
  setInstructionsTrust,
  toggleSkillTrust
} from '@/lib/capability-view'
import { formatRelative, repoName } from '@/lib/format'
import { contextFill, contextTokens, formatTokens } from '@/lib/usage'
import { CONTEXT_WINDOWS_LAST_VERIFIED } from '../../../../shared/context-windows'
import { cn } from '@/lib/utils'
import type { RepoOffers } from '../../../../shared/ipc-contract'
import type { PersonaBackend, RepoTrust } from '@/types'

/**
 * What this contact's next turn would actually be handed (blueprint §5).
 *
 * Two kinds of number here and they are deliberately not mixed. Everything
 * composed — the system prompt, the skills, the repo log — is reported in
 * **characters**, because nothing in this app can tokenize for either backend
 * and a chars/4 guess printed beside a measured figure would read as equally
 * authoritative. The token count is the one the backend actually billed,
 * straight out of usage_events.
 *
 * A "Skill" here is this app's kind — injected prose composed into the system
 * prompt — not a Claude Code or Codex skill, which is an executable capability
 * discovered from disk. The two are sealed apart on purpose; see CLAUDE.md.
 *
 * **Three levels, not one.** This was twelve sibling rows at one weight, which
 * made "Session" look like as big a claim as "From the repository" and left the
 * reader no way in. Now: the contact identifies the sheet in its header, four
 * `Group`s say what kind of fact follows, and the small-caps `Row` labels are
 * the leaf. The groups are the questions someone opens this panel to ask —
 * what it was told, what the repository is allowed to add, what it can reach,
 * what it can see — rather than the order the data happens to arrive in.
 */
export function ContextPanel({
  contactId,
  backend,
  open,
  onOpenChange
}: {
  contactId: string
  backend: PersonaBackend
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  // Gated on `open`: this stats the filesystem for sibling branches, and there
  // is no reason to pay for that on every render of the thread.
  const { data: context, isPending } = useContactContext(contactId, open)
  // What the repository is *offering*, which is a different question from what
  // a turn would send — you cannot approve a skill nothing told you exists.
  const { data: offers } = useRepoOffers(contactId, open)
  const { data: events = [] } = useUsageEvents(contactId)
  const [showText, setShowText] = useState(false)

  const tokens = contextTokens(events, context?.sessionId ?? null, backend)
  // Same two helpers the thread header's meter uses, so the panel and the
  // header cannot end up disagreeing about how full the session is.
  const fill = tokens ? contextFill(tokens) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader className="border-border shrink-0 border-b pb-3">
          <SheetTitle>What this contact works with</SheetTitle>
          <SheetDescription>
            Composed fresh for every turn, so this moves as colleagues write summaries and open
            branches.
          </SheetDescription>
          {/* Whose context this is, at the top, where the subject of a document
              belongs. It used to be the first of twelve anonymous rows, set at
              the same size as the session id. */}
          {context && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-foreground text-sm font-medium">{context.persona.name}</span>
              <BackendBadge backend={context.persona.backend} />
              <span className="text-muted-foreground font-mono text-meta">
                {context.persona.model ?? "default (backend's choice)"}
              </span>
            </div>
          )}
        </SheetHeader>

        {isPending || !context ? (
          <EmptyState
            compact
            loading={isPending}
            title={isPending ? 'Reading…' : 'Nothing to show'}
            {...(isPending ? {} : { description: 'This contact no longer exists.' })}
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="@container/sheet flex flex-col gap-5 px-4 pb-4">
              <Group title="Instructions" description="The prose this app composes for every turn.">
                <Row label="System prompt">
                  <Chars n={context.systemPromptChars} />
                </Row>

                <Row label={`Skills (${context.skills.length})`}>
                  {context.skills.length === 0 ? (
                    <Muted>None attached.</Muted>
                  ) : (
                    <Rows>
                      {context.skills.map((skill) => (
                        <Pair key={skill.id} left={skill.name} right={<Chars n={skill.chars} />} />
                      ))}
                    </Rows>
                  )}
                </Row>
              </Group>

              <Separator />

              {/*
                Everything in this group comes from the *repository*, and every
                one of them is empty until a human opted this Contact in — which
                is the app's whole governance story, so the panel says so out
                loud rather than rendering nothing and letting silence mean two
                different things.

                Note the wording: these are the model's own executable skills,
                discovered from disk, not the injected prose above that this app
                also calls a Skill. The labels have to keep them apart.
              */}
              <Group
                title="From this repository"
                description="Off until you say otherwise. These are the only two grants on this sheet."
              >
                <Row label="Its own instructions">
                  <RepoInstructionsTrust
                    contactId={contactId}
                    trust={context.repoTrust}
                    offeredFile={offers?.instructionsFile ?? null}
                    injected={context.repoInstructions}
                  />
                </Row>

                <Row
                  label={`Its skills (${context.repoSkills.length + context.injectedSkills.length})`}
                >
                  <RepoSkillTrust contactId={contactId} trust={context.repoTrust} offers={offers} />
                </Row>
              </Group>

              <Separator />

              <Group title="What it can reach" description="Beyond the files in its own checkout.">
                {/*
                  Two lists, not one, because "no servers" would otherwise mean
                  two different things on the same screen — nothing granted, and
                  something granted that is currently unreachable. The session is
                  told the same distinction; see SessionSpec.unavailableServers.
                */}
                <Row label={`Tools (${context.mcpServers.length})`}>
                  {context.mcpServers.length === 0 && context.unavailableServers.length === 0 ? (
                    <Muted>No servers reachable. This session can only touch its own files.</Muted>
                  ) : (
                    <Rows>
                      {context.mcpServers.map((server) => (
                        <Pair
                          key={server.id}
                          left={<span className="truncate font-mono text-meta">{server.url}</span>}
                          right={`${server.deniedTools} blocked`}
                        />
                      ))}
                      {context.unavailableServers.map((server) => (
                        <Pair
                          key={server.id}
                          left={
                            <span className="text-muted-foreground min-w-0">
                              <span className="block truncate font-mono text-meta">
                                {server.id}
                              </span>
                              <span className="block text-meta">{server.reason}</span>
                            </span>
                          }
                          right={<span className="text-scope-elevated">unavailable</span>}
                          plain
                        />
                      ))}
                    </Rows>
                  )}
                </Row>

                {/*
                  Everything else on this panel is something a human granted.
                  These are not, and cannot be revoked on either backend — so
                  omitting them would make this read as a list of everything a
                  session can do while being a list of only the granted part.
                  Measured, not reasoned; see docs/plan/00-progress.md.
                */}
                <Row label="Built in">
                  <Muted>{builtInNote(context.persona.backend)}</Muted>
                </Row>

                <Row label="Where it works">
                  <span className="font-mono text-meta break-all">
                    {context.workingContext
                      ? `${repoName(context.workingContext.repoPath)} · ${context.workingContext.branch}`
                      : 'the repository itself'}
                  </span>
                  {context.workingContext && (
                    <Muted>Its own checkout, so its changes are on a branch of its own.</Muted>
                  )}
                </Row>
              </Group>

              <Separator />

              <Group
                title="What it can see"
                description="Written by colleagues and by its own past turns, not by you."
              >
                <Row label={`Repo log (${context.groupContext.length})`}>
                  {context.groupContext.length === 0 ? (
                    <Muted>Nothing recorded on this repository yet.</Muted>
                  ) : (
                    <Rows>
                      {context.groupContext.map((entry) => (
                        <Pair
                          key={entry.timestamp}
                          left={
                            <>
                              {entry.category ?? 'entry'}
                              {entry.durable && (
                                <span className="text-muted-foreground"> · kept</span>
                              )}
                            </>
                          }
                          right={`${formatRelative(entry.timestamp)} · ${entry.chars.toLocaleString()}`}
                        />
                      ))}
                    </Rows>
                  )}
                </Row>

                {context.siblingBranches.length > 0 && (
                  <Row label="Work on other branches">
                    <Rows>
                      {context.siblingBranches.map((sibling) => (
                        <Pair
                          key={sibling.branch}
                          left={
                            <span className="truncate font-mono text-meta">{sibling.branch}</span>
                          }
                          right={sibling.contactName}
                          plain
                        />
                      ))}
                    </Rows>
                  </Row>
                )}

                <Row label="Session">
                  {context.sessionId ? (
                    <span className="font-mono text-meta break-all">{context.sessionId}</span>
                  ) : (
                    <Muted>No turn has run yet, so there is nothing to resume.</Muted>
                  )}
                </Row>
              </Group>

              <Separator />

              <Group title="Prompt size">
                {/*
                  Three tiles, because they are three claims. The prompt stops
                  growing when the conversation does; the bill keeps climbing
                  for as long as you keep talking, because every turn re-sends
                  the history. Showing only the second under the label "prompt
                  size" is what this panel used to do, and on Codex it over-read
                  threefold by turn three.
                */}
                <div className="grid gap-1.5 grid-cols-2 @sm/sheet:grid-cols-3">
                  <StatTile
                    label="Instructions"
                    value={context.instructionsChars.toLocaleString()}
                    note="characters, before the conversation"
                  />
                  <StatTile
                    label="Last request"
                    value={tokens ? formatTokens(tokens.lastPromptTokens) : '—'}
                    note={
                      fill
                        ? `tokens · about ${Math.round(fill.fraction * 100)}% of the window`
                        : 'tokens'
                    }
                  />
                  <StatTile
                    label="Billed"
                    value={tokens ? formatTokens(tokens.billedInputTokens) : '—'}
                    note={
                      tokens
                        ? `input tokens across ${tokens.turns} ${tokens.turns === 1 ? 'turn' : 'turns'}`
                        : 'input tokens'
                    }
                  />
                </div>

                {/*
                  Which arithmetic produced those, spelled out. The two backends
                  record incompatible things — Claude re-sends the whole
                  conversation each turn, Codex reports increments — so the same
                  tiles mean different things, and a bare number would be two
                  claims wearing one label.
                */}
                {tokens ? (
                  <Muted>
                    {tokens.reading === 'last-turn'
                      ? 'Claude re-sends the whole conversation each turn, so the first figure is the last turn’s prompt.'
                      : 'Codex reports increments, so the first figure is the last turn’s own increment.'}{' '}
                    {fill
                      ? `Approximate: one turn reports a single figure covering every request it made, so a turn that ran several tools reads high. Window ${formatTokens(fill.window)}, ${fill.windowSource === 'published' ? 'as published' : 'inferred from the model family'} on ${CONTEXT_WINDOWS_LAST_VERIFIED}.`
                      : 'No percentage: this app has no context-window figure for this model, and a guess would look like a measurement.'}
                  </Muted>
                ) : (
                  <Muted>Nothing has been sent on this session yet.</Muted>
                )}
              </Group>
            </div>
          </ScrollArea>
        )}

        {/*
          The payoff, and the reason this needed a procedure rather than being
          assembled in the renderer: these are the literal bytes both adapters
          receive, not a reconstruction that could drift.

          In the footer because it is not one of the facts above — it is all of
          them, verbatim. It used to sit unlabelled under the last row at a
          different left alignment from everything else on the sheet.
        */}
        {context && (
          <SheetFooter className="border-border shrink-0 border-t p-4 pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1.5 self-start"
              onClick={() => setShowText((value) => !value)}
            >
              {showText ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {showText ? 'Hide the exact text' : 'Show the exact text'}
            </Button>
            {showText && (
              <pre className="border-border bg-muted/40 scrollbar-subtle max-h-80 overflow-auto rounded-lg border p-3 font-mono text-code leading-relaxed whitespace-pre-wrap">
                {context.instructions}
              </pre>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * One of the four questions this sheet answers, with its `Row`s inside it.
 *
 * `Section` rather than another local helper, for the reason its own docstring
 * gives: this panel's `Row` is exactly the drift that component was extracted
 * to end, and a fifth hand-rolled heading here would have been the sixth.
 */
function Group({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Section title={title} {...(description ? { description } : {})}>
      <div className="flex flex-col gap-4">{children}</div>
    </Section>
  )
}

/** A leaf fact, under its small-caps label. */
function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <p className={CAPTION}>{label}</p>
      <div className="flex flex-col gap-1 text-xs">{children}</div>
    </div>
  )
}

/**
 * A repeated two-column list — a name on the left, a measure on the right.
 *
 * Ruled, because four of these appear on one sheet and the repo log runs to
 * eight entries; unruled they read as a paragraph of numbers. `Pair` fixes the
 * type on both sides, which four hand-rolled copies of this had stopped doing:
 * one column was `text-xs` sans and its neighbour on the same baseline was
 * `text-meta` mono.
 */
function Rows({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <ul className="divide-border/60 flex flex-col divide-y">{children}</ul>
}

function Pair({
  left,
  right,
  plain = false
}: {
  left: React.ReactNode
  right: React.ReactNode
  /** The right column is a measure by default. Set for a name or a word. */
  plain?: boolean
}): React.JSX.Element {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1 first:pt-0 last:pb-0">
      <span className="min-w-0 truncate text-xs">{left}</span>
      <span
        className={cn(
          'text-muted-foreground shrink-0 truncate',
          // Not left to a class merge: `text-meta` is a project utility over a
          // CSS variable, and tailwind-merge has no reason to know it is a font
          // size, so both would survive and the winner would be file order.
          plain ? 'text-xs' : 'font-mono text-meta tabular-nums'
        )}
      >
        {right}
      </span>
    </li>
  )
}

function Muted({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-muted-foreground text-xs">{children}</span>
}

/**
 * A size, always labelled. A bare number here would be read as tokens, which
 * is the one thing it is not — see the note at the top of this file.
 */
function Chars({ n }: { n: number }): React.JSX.Element {
  return (
    <span className="text-muted-foreground shrink-0 font-mono text-meta tabular-nums">
      {n.toLocaleString()} chars
    </span>
  )
}

/**
 * The repository's own instructions, and the switch that lets them through.
 *
 * The grant lives on the same row as its effect on purpose. Reading "the
 * session never sees it" in one screen and turning it on in another is how a
 * governance control ends up being described accurately and used by nobody.
 *
 * Three states, and they are genuinely different: the repository ships no such
 * file at all, it ships one nobody has trusted, or it ships one that is being
 * injected. A single "off" would collapse the first two.
 */
function RepoInstructionsTrust({
  contactId,
  trust,
  offeredFile,
  injected
}: {
  contactId: string
  trust: RepoTrust
  offeredFile: string | null
  injected: { fileName: string; chars: number } | null
}): React.JSX.Element {
  const { set, isPending, error } = useSetRepoTrust()

  if (!offeredFile) {
    return <Muted>This repository ships no CLAUDE.md or AGENTS.md.</Muted>
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-border flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-mono text-meta">{offeredFile}</p>
          <p className="text-muted-foreground text-xs">
            {trust.instructions
              ? 'Injected into every turn, framed as the repository’s conventions rather than as orders.'
              : 'Written by whoever owns this repository. Off until you say otherwise.'}
          </p>
        </div>
        <Switch
          checked={trust.instructions}
          onCheckedChange={(next) => set(contactId, setInstructionsTrust(trust, next))}
          disabled={isPending}
          aria-label="Trust this repository's instructions"
        />
      </div>
      {injected && <Chars n={injected.chars} />}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/**
 * Every skill the repository ships, and which of them this contact may use.
 *
 * An allowlist of names rather than one switch, because approving "this repo's
 * skills" would silently extend to whatever is committed tomorrow. The delivery
 * label is not decoration either — a described skill costs prompt space on
 * every turn and can only be read as a file, while a discovered one is invoked
 * as a skill by the backend itself.
 */
function RepoSkillTrust({
  contactId,
  trust,
  offers
}: {
  contactId: string
  trust: RepoTrust
  offers: RepoOffers | null | undefined
}): React.JSX.Element {
  const { set, isPending, error } = useSetRepoTrust()
  const choices = repoSkillChoices(offers ?? null, trust)

  if (choices.length === 0) {
    return <Muted>This repository ships no skills.</Muted>
  }

  return (
    <div className="flex flex-col gap-1.5">
      {choices.map((choice) => (
        <CheckRow
          key={choice.name}
          checked={choice.approved}
          onToggle={() => set(contactId, toggleSkillTrust(trust, choice.name))}
          className={cn(isPending && 'pointer-events-none opacity-70')}
          title={choice.name}
          description={
            choice.missing ? (
              // A stored approval with no file behind it. Visible so it can be
              // cleared rather than quietly doing nothing.
              <span className="text-scope-elevated">{choice.description}</span>
            ) : (
              <>
                {choice.description || <span className="italic">No description.</span>}
                <span className="text-muted-foreground/80">
                  {' '}
                  {choice.root} ·{' '}
                  {choice.delivery === 'discovered'
                    ? 'the backend finds this itself'
                    : 'described to the model, since the backend cannot find it'}
                </span>
              </>
            )
          }
        />
      ))}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}
