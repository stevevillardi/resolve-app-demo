import { useState } from 'react'
import { Check, Clock, Play, Trash2 } from 'lucide-react'
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
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { PaneHeader } from '@/components/common/PaneHeader'
import { PaneBody } from '@/components/common/PaneBody'
import { Field } from '@/components/common/Field'
import { Section } from '@/components/common/Section'
import { formatRelative } from '@/lib/format'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import {
  useCronValidation,
  useDeleteRoutine,
  useRoutines,
  useRunRoutineNow,
  useUpdateRoutine
} from '@/hooks/useRoutines'
import { useUiStore } from '@/store/useUiStore'
import type { Routine } from '@/types'

/**
 * When a valid schedule next fires, as an absolute local time.
 *
 * Replaces a lookup table of five hardcoded cron strings that fell back to
 * echoing the raw expression at the person who just typed it. The next fire is
 * both more useful and true of any expression, and it comes from node-cron
 * itself rather than from our reading of the syntax.
 */
function scheduleHint(nextRuns: number[]): string {
  if (nextRuns.length === 0) return 'Cron expression, e.g. 0 9 * * * for every day at 09:00.'
  return `Next: ${new Date(nextRuns[0]).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })}`
}

function RoutineForm({ routine }: { routine: Routine }): React.JSX.Element {
  const [schedule, setSchedule] = useState(routine.schedule)
  const [prompt, setPrompt] = useState(routine.prompt)
  const [enabled, setEnabled] = useState(routine.enabled)
  const [contactId, setContactId] = useState(routine.contactId)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const contacts = useContacts().data ?? []
  const personaTemplates = usePersonas().data ?? []
  const { error: cronError, nextRuns } = useCronValidation(schedule)
  const { save, isPending: saving, error: saveError } = useUpdateRoutine()
  const { remove } = useDeleteRoutine()
  const { runNow, isPending: running, skipped } = useRunRoutineNow()
  const setSelectedRoutineId = useUiStore((state) => state.setSelectedRoutineId)

  const contact = contacts.find((c) => c.id === contactId)
  const persona = personaTemplates.find((p) => p.id === contact?.personaTemplateId)

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <PaneHeader
        leading={<Clock className="text-muted-foreground size-4 shrink-0" />}
        title={persona?.name ?? 'Routine'}
        {...(contact && { subtitle: contact.repoPath })}
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
              disabled={running}
              onClick={() => runNow(routine.id)}
            >
              <Play className="size-3.5" />
              Run now
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={saving || Boolean(cronError)}
              onClick={() => save({ id: routine.id, contactId, schedule, prompt, enabled })}
            >
              <Check className="size-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      <PaneBody>
        <div className="border-border flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
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

        <Field
          label="Schedule"
          htmlFor="routine-schedule"
          hint={scheduleHint(nextRuns)}
          {...(cronError ? { error: cronError } : {})}
        >
          <Input
            id="routine-schedule"
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
            aria-invalid={Boolean(cronError)}
            className="font-mono"
          />
        </Field>

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
