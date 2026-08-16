import { useState } from 'react'
import { Clock, Play } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { EmptyState } from '@/components/common/EmptyState'
import { formatRelative } from '@/lib/format'
// Still mock-fed: the routines table exists as of Phase 4 but has no CRUD
// and no scheduler until Phase 8 (docs/plan/08-routines-scheduler.md).
import { contacts, personaTemplates, routines } from '@/mocks'
import { useUiStore } from '@/store/useUiStore'
import type { Routine } from '@/types'

// A cron string is unreadable at a glance; this covers the common cases and
// falls back to showing the raw expression. Real parsing lands in Phase 8.
const SCHEDULE_LABEL: Record<string, string> = {
  '0 9 * * *': 'Every day at 09:00',
  '0 */6 * * *': 'Every 6 hours',
  '0 0 * * *': 'Every day at midnight',
  '*/15 * * * *': 'Every 15 minutes',
  '0 9 * * 1': 'Every Monday at 09:00'
}

function RoutineForm({ routine }: { routine: Routine }): React.JSX.Element {
  const [schedule, setSchedule] = useState(routine.schedule)
  const [prompt, setPrompt] = useState(routine.prompt)
  const [enabled, setEnabled] = useState(routine.enabled)
  const [contactId, setContactId] = useState(routine.contactId)
  // Reserved for Phase 8's cron validation — always undefined this phase.
  const cronError: string | undefined = undefined

  const contact = contacts.find((c) => c.id === contactId)
  const persona = personaTemplates.find((p) => p.id === contact?.personaTemplateId)

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <header className="border-border drag-region flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
        <Clock className="text-muted-foreground size-4 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {persona?.name ?? 'Routine'}
        </h1>
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Play className="size-3.5" />
            Run now
          </Button>
          <Button size="sm">Save</Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 p-5">
          <div className="border-border flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium">Enabled</p>
              <p className="text-muted-foreground text-xs">
                {enabled
                  ? 'Fires on schedule even when the window is closed.'
                  : 'Paused. Kept, but never fires.'}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Routine enabled" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Runs as</Label>
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
                <span className="text-muted-foreground font-mono text-[11px]">
                  {contact?.repoPath}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-schedule">Schedule</Label>
            <Input
              id="routine-schedule"
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
              aria-invalid={Boolean(cronError)}
              className="font-mono"
            />
            {cronError ? (
              <p className="text-destructive text-xs">{cronError}</p>
            ) : (
              <p className="text-muted-foreground text-xs">
                {SCHEDULE_LABEL[schedule] ?? `Cron expression — ${schedule}`}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-prompt">Prompt</Label>
            <Textarea
              id="routine-prompt"
              rows={5}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What should this routine do when it wakes up?"
            />
            <p className="text-muted-foreground text-xs">
              Sent as the opening message each time it fires. The result posts to the repo group.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Last run</h2>
            {routine.lastRunAt ? (
              <div className="border-border rounded-lg border p-3">
                <p className="text-muted-foreground font-mono text-[11px]">
                  {formatRelative(routine.lastRunAt)}
                </p>
                <p className="mt-1 text-[13px]">{routine.lastRunSummary}</p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">Hasn&apos;t run yet.</p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

export function RoutineEditor(): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedRoutineId)
  const routine = routines.find((r) => r.id === selectedId)

  if (!routine) {
    return (
      <div className="bg-background flex h-full flex-col">
        <div className="drag-region h-12 shrink-0" />
        <EmptyState
          icon={Clock}
          title="No routine selected"
          description="Routines wake a persona on a schedule and post what they did to the repo group."
        />
      </div>
    )
  }

  return <RoutineForm key={routine.id} routine={routine} />
}
