import { useState } from 'react'
import { Check, Clock, MessageSquare, Play, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { RunPulse } from '@/components/common/RunIndicator'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { PaneHeader } from '@/components/common/PaneHeader'
import { PaneBody } from '@/components/common/PaneBody'
import { Field } from '@/components/common/Field'
import { FieldGrid, FieldGridSpan } from '@/components/common/FieldGrid'
import { SchedulePicker } from './SchedulePicker'
import { Section } from '@/components/common/Section'
import { formatRelative, repoName } from '@/lib/format'
import { formatElapsed } from '@/lib/home'
import { routineRun } from '@/lib/run-view'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import {
  useCronValidation,
  useDeleteRoutine,
  useRoutines,
  useRunRoutineNow,
  useUpdateRoutine
} from '@/hooks/useRoutines'
import { useActiveRuns, useCancelRun } from '@/hooks/useMessages'
import { useNow } from '@/hooks/useNow'
import { useUiStore } from '@/store/useUiStore'
import type { Routine } from '@/types'

function RoutineForm({ routine }: { routine: Routine }): React.JSX.Element {
  const [schedule, setSchedule] = useState(routine.schedule)
  const [prompt, setPrompt] = useState(routine.prompt)
  const [enabled, setEnabled] = useState(routine.enabled)
  const [contactId, setContactId] = useState(routine.contactId)
  // Kept as the typed string so "12." mid-keystroke survives; parsed at save.
  const [budgetText, setBudgetText] = useState(
    routine.monthlyBudgetUsd === null ? '' : String(routine.monthlyBudgetUsd)
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const contacts = useContacts().data ?? []
  const personaTemplates = usePersonas().data ?? []
  const { error: cronError, nextRuns } = useCronValidation(schedule)
  const { save, isPending: saving, error: saveError } = useUpdateRoutine()
  const { remove } = useDeleteRoutine()
  const { runNow, isPending: starting, skipped } = useRunRoutineNow()
  // The live half (Phase 25): a routine mid-fire used to be indistinguishable
  // from an idle one in its own editor — the button stayed clickable and the
  // pane showed the PREVIOUS run's summary as if it were current.
  const { data: runs = [] } = useActiveRuns()
  const liveRun = routineRun(runs, routine.id)
  const now = useNow(Boolean(liveRun))
  const { cancel } = useCancelRun()
  const setSection = useUiStore((state) => state.setSection)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)
  const setSelectedRoutineId = useUiStore((state) => state.setSelectedRoutineId)

  const contact = contacts.find((c) => c.id === contactId)
  const persona = personaTemplates.find((p) => p.id === contact?.personaTemplateId)

  const parsedBudget = ((): number | null => {
    const trimmed = budgetText.trim()
    if (trimmed === '') return null
    const value = Number(trimmed)
    return Number.isFinite(value) && value > 0 ? value : null
  })()

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      {/* The subtitle is the repo's name with the path on hover. Phase 13 fixed
          exactly this in ThreadView and missed this pane: an absolute macOS temp
          checkout is 80 characters and takes the whole header to say what its
          last segment already says. */}
      <PaneHeader
        leading={<Clock className="text-muted-foreground size-4 shrink-0" />}
        title={persona?.name ?? 'Routine'}
        {...(contact && { subtitle: repoName(contact.repoPath), subtitleTitle: contact.repoPath })}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete routine"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={starting || Boolean(liveRun)}
              onClick={() =>
                runNow(routine.id, (result) =>
                  toast(result.skipped ? `Skipped — ${result.skipped}` : 'Run started')
                )
              }
            >
              {liveRun ? <RunPulse /> : <Play className="size-3.5" />}
              {liveRun ? 'Running' : starting ? 'Starting…' : 'Run now'}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={saving || Boolean(cronError)}
              onClick={() =>
                save({
                  id: routine.id,
                  contactId,
                  schedule,
                  prompt,
                  enabled,
                  monthlyBudgetUsd: parsedBudget
                })
              }
            >
              <Check className="size-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      <PaneBody>
        <div className="border-border flex max-w-3xl items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <div>
            <p className="text-row font-medium">Enabled</p>
            <p className="text-muted-foreground text-xs">
              {enabled
                ? 'Fires on schedule even when the window is closed.'
                : 'Paused. Kept, but never fires.'}
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Routine enabled" />
        </div>

        <FieldGrid>
          <Field label="Runs as">
            <Select
              value={contactId}
              onValueChange={(value) => setContactId(value as string)}
              items={contacts.map((c) => ({ label: c.displayName, value: c.id }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((option) => {
                  const optionPersona = personaTemplates.find(
                    (p) => p.id === option.personaTemplateId
                  )
                  return (
                    <SelectItem key={option.id} value={option.id}>
                      <AvatarColorSwatch
                        name={optionPersona?.name ?? option.displayName}
                        color={optionPersona?.avatarColor ?? 'var(--muted)'}
                        seed={optionPersona?.id}
                        size="xs"
                      />
                      {option.displayName}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {/* An unattended routine inherits its persona's permissions, so
              what it is allowed to do belongs right next to who runs it. */}
            {persona && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <ScopeChip axis="sandbox" value={persona.sandbox} />
                <ScopeChip axis="github" value={persona.githubScope} />
              </div>
            )}
          </Field>

          <Field label="Schedule">
            <SchedulePicker
              value={schedule}
              onChange={setSchedule}
              error={cronError}
              nextRuns={nextRuns}
            />
          </Field>

          <Field
            label="Monthly budget"
            htmlFor="routine-budget"
            hint="Alerts when this routine's month crosses it — nothing is stopped. Empty means no budget."
          >
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-sm">$</span>
              <Input
                id="routine-budget"
                className="w-28 text-right font-mono tabular-nums"
                inputMode="decimal"
                placeholder="none"
                value={budgetText}
                onChange={(event) => setBudgetText(event.target.value)}
              />
              <span className="text-muted-foreground text-sm">/ month</span>
            </div>
          </Field>

          <FieldGridSpan>
            <Field
              label="Prompt"
              htmlFor="routine-prompt"
              hint="Sent as the opening message each time it fires. The result posts to the repo group."
            >
              <Textarea
                id="routine-prompt"
                rows={5}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What should this routine do when it wakes up?"
              />
            </Field>
          </FieldGridSpan>
        </FieldGrid>

        {/* Blueprint §7: an unattended task should propose via PR, not push
            unsupervised. The persona is where githubScope lives, so this steers
            rather than silently overriding what the persona was set up with. */}
        {persona?.githubScope === 'full_access' && (
          <p className="text-muted-foreground border-border rounded-lg border border-dashed p-3 text-xs">
            {persona.name} can push directly. For something that runs unattended, a persona scoped
            to <span className="font-medium">open PR</span> is safer — the work still happens, it
            just arrives as a pull request someone can look at.
          </p>
        )}

        {skipped && <p className="text-muted-foreground text-xs">{skipped}</p>}
        {saveError && <p className="text-destructive text-xs">{saveError}</p>}

        <Section title="Last run">
          {liveRun && (
            <div className="border-primary/40 flex items-center gap-2.5 rounded-lg border p-3">
              <RunPulse />
              <span className="text-primary text-row flex-1 font-medium">
                Running · {formatElapsed(liveRun.startedAt, now)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setSection('chats')
                  setSelectedConversation({ kind: 'contact', id: liveRun.contactId })
                }}
              >
                <MessageSquare className="size-3.5" />
                View conversation
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Stop this run"
                onClick={() => cancel(liveRun.runId)}
              >
                <Square className="size-3.5" />
              </Button>
            </div>
          )}
          {routine.lastRunAt ? (
            <div className="border-border rounded-lg border p-3">
              <p className="text-muted-foreground font-mono text-meta">
                {formatRelative(routine.lastRunAt)}
              </p>
              <p className="mt-1 text-row">{routine.lastRunSummary}</p>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">Hasn&apos;t run yet.</p>
          )}
          {/* The silence review §C2 ends: a laptop asleep at 9:00 skips the
              fire outright (a recorded Phase 8 decision), and until now the
              only trace was a console.warn. Run now — the button above — is
              the catch-up, and clears this. */}
          {routine.missedRunCount > 0 && (
            <div className="border-scope-elevated/40 bg-scope-elevated-bg/30 rounded-lg border p-3">
              <p className="text-scope-elevated text-meta font-medium">
                Missed{' '}
                {routine.missedRunCount === 1
                  ? '1 scheduled run'
                  : `${routine.missedRunCount} scheduled runs`}
                {routine.lastMissedAt ? `, last ${formatRelative(routine.lastMissedAt)}` : ''}
              </p>
              <p className="text-muted-foreground mt-1 text-xs text-pretty">
                Schedules don&apos;t fire while the app is closed or the machine sleeps, and a
                missed fire is never run late. Run now catches up.
              </p>
            </div>
          )}
        </Section>
      </PaneBody>

      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete this routine?`}
        description="It stops firing immediately. The conversation it has been having with its contact is kept."
        onConfirm={() => remove(routine.id, () => setSelectedRoutineId(null))}
      />
    </div>
  )
}

export function RoutineEditor(): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedRoutineId)
  const routine = useRoutines().data?.find((r) => r.id === selectedId)

  if (!routine) {
    return (
      <EmptyPane
        icon={Clock}
        title="No routine selected"
        description="Routines wake a persona on a schedule and post what they did to the repo group."
      />
    )
  }

  return <RoutineForm key={routine.id} routine={routine} />
}
