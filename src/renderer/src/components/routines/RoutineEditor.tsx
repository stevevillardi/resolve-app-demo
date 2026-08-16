import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { contacts } from '@/mocks'
import type { Routine } from '@/types'

interface RoutineEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  routine?: Routine
}

export function RoutineEditor({
  open,
  onOpenChange,
  routine
}: RoutineEditorProps): React.JSX.Element {
  const [schedule, setSchedule] = useState(routine?.schedule ?? '0 9 * * *')
  const [prompt, setPrompt] = useState(routine?.prompt ?? '')
  const [enabled, setEnabled] = useState(routine?.enabled ?? true)
  const [contactId, setContactId] = useState(routine?.contactId ?? contacts[0]?.id ?? '')
  // Reserved for Phase 8's cron validation — always undefined this phase.
  const cronError: string | undefined = undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{routine ? 'Edit routine' : 'New routine'}</SheetTitle>
          <SheetDescription>
            Runs on a schedule, on the persona it&apos;s bound to.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="routine-contact">
              Contact
            </label>
            <select
              id="routine-contact"
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
            >
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="routine-schedule">
              Schedule (cron)
            </label>
            <Input
              id="routine-schedule"
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
              aria-invalid={Boolean(cronError)}
            />
            {cronError && <p className="text-destructive text-xs">{cronError}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="routine-prompt">
              Prompt
            </label>
            <Textarea
              id="routine-prompt"
              rows={4}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What should this routine do when it wakes up?"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Enabled</span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
              />
            </button>
          </div>
          {routine?.lastRunSummary && (
            <p className="text-muted-foreground text-xs">Last run: {routine.lastRunSummary}</p>
          )}
        </div>
        <SheetFooter>
          <Button onClick={() => onOpenChange(false)}>Save routine</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
