import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { BackendBadge } from '@/components/common/BackendBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { useContactContext } from '@/hooks/useConversations'
import { useUsageEvents } from '@/hooks/useUsage'
import { formatRelative, repoName } from '@/lib/format'
import { contextTokens, formatTokens } from '@/lib/usage'
import type { PersonaBackend } from '@/types'

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
  const { data: events = [] } = useUsageEvents(contactId)
  const [showText, setShowText] = useState(false)

  const tokens = contextTokens(events, context?.sessionId ?? null, backend)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>What this contact works with</SheetTitle>
          <SheetDescription>
            Composed fresh for every turn, so this moves as colleagues write summaries and open
            branches.
          </SheetDescription>
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
            <div className="flex flex-col gap-5 px-4 pb-4">
              <Row label="Persona">
                <span className="flex items-center gap-2">
                  {context.persona.name}
                  <BackendBadge backend={context.persona.backend} />
                </span>
                <span className="text-muted-foreground font-mono text-meta">
                  {context.persona.model ?? "default (backend's choice)"}
                </span>
              </Row>

              <Row label="System prompt">
                <Chars n={context.systemPromptChars} />
              </Row>

              <Row label={`Skills (${context.skills.length})`}>
                {context.skills.length === 0 ? (
                  <Muted>None attached.</Muted>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {context.skills.map((skill) => (
                      <li key={skill.id} className="flex items-baseline justify-between gap-3">
                        <span className="truncate">{skill.name}</span>
                        <Chars n={skill.chars} />
                      </li>
                    ))}
                  </ul>
                )}
              </Row>

              {/*
                Everything below comes from the *repository*, and every one of
                these is empty until a human opted this Contact in — which is
                the app's whole governance story, so the panel says so out loud
                rather than rendering nothing and letting silence mean two
                different things.

                Note the wording: these are the model's own executable skills,
                discovered from disk, not the injected prose above that this app
                also calls a Skill. The labels have to keep them apart.
              */}
              <Row label="From the repository">
                {context.repoInstructions ? (
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-meta">
                      {context.repoInstructions.fileName}
                    </span>
                    <Chars n={context.repoInstructions.chars} />
                  </span>
                ) : (
                  <Muted>
                    No repository instructions. Its CLAUDE.md / AGENTS.md is not trusted by this
                    contact, so the session never sees it.
                  </Muted>
                )}
              </Row>

              <Row
                label={`Repo skills (${context.repoSkills.length + context.injectedSkills.length})`}
              >
                {context.repoSkills.length === 0 && context.injectedSkills.length === 0 ? (
                  <Muted>
                    None. Skills the repository ships are disabled by name unless opted in.
                  </Muted>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {context.repoSkills.map((name) => (
                      <li key={name} className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-mono text-meta">{name}</span>
                        <span className="text-muted-foreground shrink-0 text-meta">discovered</span>
                      </li>
                    ))}
                    {context.injectedSkills.map((skill) => (
                      <li key={skill.name} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-meta">{skill.name}</span>
                          <span className="text-muted-foreground block truncate text-meta">
                            {skill.description}
                          </span>
                        </span>
                        {/* Named in the prompt because the backend cannot find
                            it for itself — on Claude that is every one of them. */}
                        <span className="text-muted-foreground shrink-0 text-meta">described</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>

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
                  <ul className="flex flex-col gap-1">
                    {context.mcpServers.map((server) => (
                      <li key={server.id} className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-mono text-meta">{server.url}</span>
                        <span className="text-muted-foreground shrink-0 text-meta">
                          {server.deniedTools} blocked
                        </span>
                      </li>
                    ))}
                    {context.unavailableServers.map((server) => (
                      <li key={server.id} className="flex items-baseline justify-between gap-3">
                        <span className="text-muted-foreground min-w-0">
                          <span className="block truncate font-mono text-meta">{server.id}</span>
                          <span className="block text-meta">{server.reason}</span>
                        </span>
                        <span className="text-scope-elevated shrink-0 text-meta">unavailable</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>

              <Row label={`Repo log (${context.groupContext.length})`}>
                {context.groupContext.length === 0 ? (
                  <Muted>Nothing recorded on this repository yet.</Muted>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {context.groupContext.map((entry) => (
                      <li
                        key={entry.timestamp}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <span className="truncate">
                          {entry.category ?? 'entry'}
                          {entry.durable && <span className="text-muted-foreground"> · kept</span>}
                        </span>
                        <span className="text-muted-foreground shrink-0 font-mono text-meta">
                          {formatRelative(entry.timestamp)} · {entry.chars.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>

              {context.siblingBranches.length > 0 && (
                <Row label="Work on other branches">
                  <ul className="flex flex-col gap-1">
                    {context.siblingBranches.map((sibling) => (
                      <li
                        key={sibling.branch}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <span className="truncate font-mono text-meta">{sibling.branch}</span>
                        <span className="text-muted-foreground shrink-0 truncate">
                          {sibling.contactName}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Row>
              )}

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

              <Row label="Session">
                {context.sessionId ? (
                  <span className="font-mono text-meta break-all">{context.sessionId}</span>
                ) : (
                  <Muted>No turn has run yet, so there is nothing to resume.</Muted>
                )}
              </Row>

              <Row label="Prompt size">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono tabular-nums">
                    {context.instructionsChars.toLocaleString()}
                  </span>
                  <Muted>characters of instructions, before the conversation itself</Muted>
                </span>

                {tokens ? (
                  <>
                    <span className="flex items-baseline gap-2">
                      <span className="text-foreground font-mono tabular-nums">
                        {formatTokens(tokens.promptTokens)}
                      </span>
                      <Muted>tokens, as billed</Muted>
                    </span>
                    {/*
                      Which arithmetic produced that, spelled out. The two
                      backends record incompatible things — Claude re-sends the
                      whole conversation each turn, Codex reports increments —
                      so the same rows mean different totals, and a bare number
                      would be two different claims wearing one label.
                    */}
                    <Muted>
                      {tokens.reading === 'last-turn'
                        ? 'Claude re-sends the whole conversation each turn, so this is the last turn’s prompt.'
                        : 'Codex reports increments, so this is every turn on this session added together.'}{' '}
                      No percentage: this app does not know this model’s context window, and a guess
                      would look like a measurement.
                    </Muted>
                  </>
                ) : (
                  <Muted>Nothing has been sent on this session yet.</Muted>
                )}
              </Row>

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 gap-1.5"
                  onClick={() => setShowText((value) => !value)}
                >
                  {showText ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  {showText ? 'Hide the exact text' : 'Show the exact text'}
                </Button>
                {/*
                  The payoff, and the reason this needed a procedure rather than
                  being assembled in the renderer: these are the literal bytes
                  both adapters receive, not a reconstruction that could drift.
                */}
                {showText && (
                  <pre className="border-border bg-muted/40 scrollbar-subtle mt-2 max-h-80 overflow-auto rounded-lg border p-3 font-mono text-code leading-relaxed whitespace-pre-wrap">
                    {context.instructions}
                  </pre>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-meta font-medium tracking-wide uppercase">{label}</p>
      <div className="flex flex-col gap-1 text-xs">{children}</div>
    </div>
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
