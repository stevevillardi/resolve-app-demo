import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import {
  buildCron,
  describeSchedule,
  parseCron,
  WEEKDAY_LABELS,
  type Frequency,
  type Schedule
} from '@/lib/cron'
import { cn } from '@/lib/utils'

const FREQUENCIES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' }
] as const

type Mode = Frequency | 'custom'

interface SchedulePickerProps {
  /** The cron expression itself. This component's only output. */
  value: string
  onChange: (expression: string) => void
  /** Main's verdict on the current expression, if it has refused it. */
  error?: string | null
  /** Upcoming fire times from `routines.validateSchedule`, as epoch ms. */
  nextRuns: number[]
}

/**
 * A schedule picker, rather than a plain text input holding five characters of
 * cron.
 *
 * The design constraint that shapes everything here: **the expression is the
 * value.** The picker never becomes a second source of truth alongside it. It
 * reads the string on every render (`parseCron`) and writes a string back on
 * every edit, so there is no picker state to fall out of sync with the field,
 * and no migration for a routine created before this existed.
 *
 * That is also what makes Custom honest rather than an escape hatch bolted on.
 * `parseCron` returns null for anything outside the small subset — steps,
 * ranges, named days, month scoping, cron's surprising day-of-month OR
 * day-of-week rule — and null *is* Custom. So an expression this cannot draw
 * opens in the raw field with its meaning intact, instead of being silently
 * rewritten into something the picker can display.
 *
 * The generated expression stays visible in every mode. A picker you cannot
 * check is worse than a plain text box for anyone who already knows cron, and
 * the next-fire times below it come from node-cron in main rather
 * than from our reading of what we just built.
 */
export function SchedulePicker({
  value,
  onChange,
  error,
  nextRuns
}: SchedulePickerProps): React.JSX.Element {
  const parsed = parseCron(value)
  const mode: Mode = parsed?.frequency ?? 'custom'

  const update = (next: Partial<Schedule>): void => {
    if (!parsed) return
    onChange(buildCron({ ...parsed, ...next }))
  }

  const setMode = (nextMode: Mode): void => {
    if (nextMode === 'custom') return
    // Switching *into* a frequency keeps the time already chosen where it still
    // applies, which is why the whole parsed schedule is spread rather than
    // starting from the defaults.
    onChange(buildCron({ ...(parsed ?? DEFAULTS), frequency: nextMode }))
  }

  const toggleWeekday = (day: number): void => {
    if (!parsed) return
    const has = parsed.weekdays.includes(day)
    const weekdays = has ? parsed.weekdays.filter((d) => d !== day) : [...parsed.weekdays, day]
    // Never empty: a weekly schedule with no day selected never fires, and
    // refusing the last removal is a better answer than writing one.
    if (weekdays.length === 0) return
    update({ weekdays })
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        options={FREQUENCIES}
        value={mode}
        onChange={setMode}
        aria-label="How often"
      />

      {parsed && parsed.frequency !== 'hourly' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">At</span>
            <Input
              type="time"
              // The one control here that is not cron-shaped: a native time
              // input is what people already know, and the two numbers behind
              // it are exactly cron's minute and hour fields.
              value={`${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':').map(Number)
                if (Number.isFinite(hour) && Number.isFinite(minute)) update({ hour, minute })
              }}
              className="w-32 font-mono"
              aria-label="Time of day"
            />
          </label>

          {parsed.frequency === 'monthly' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Day of month</span>
              <Input
                type="number"
                min={1}
                max={31}
                value={parsed.dayOfMonth}
                onChange={(event) => {
                  const day = Number(event.target.value)
                  if (day >= 1 && day <= 31) update({ dayOfMonth: day })
                }}
                className="w-20 font-mono"
                aria-label="Day of month"
              />
            </label>
          )}
        </div>
      )}

      {parsed?.frequency === 'hourly' && (
        <label className="flex w-32 flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">Minutes past</span>
          <Input
            type="number"
            min={0}
            max={59}
            value={parsed.minute}
            onChange={(event) => {
              const minute = Number(event.target.value)
              if (minute >= 0 && minute <= 59) update({ minute })
            }}
            className="font-mono"
            aria-label="Minutes past the hour"
          />
        </label>
      )}

      {parsed?.frequency === 'weekly' && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Days of the week">
          {WEEKDAY_LABELS.map((label, day) => {
            const on = parsed.weekdays.includes(day)
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleWeekday(day)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/*
        Always visible, in every mode, and editable in Custom. The expression is
        the value — hiding it would make this a picker you cannot check, which
        is a downgrade for anyone who already knows cron.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          readOnly={mode !== 'custom'}
          aria-invalid={Boolean(error)}
          aria-label="Cron expression"
          className={cn(
            'w-44 font-mono',
            mode !== 'custom' && 'text-muted-foreground bg-muted/40 cursor-default'
          )}
        />
        <span className="text-muted-foreground text-xs">
          {error ? '' : parsed ? describeSchedule(parsed) : 'Custom schedule.'}
        </span>
      </div>

      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : (
        // From node-cron in main, not from our reading of the string we just
        // built. This is the line that settles whether a schedule is right.
        nextRuns.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Next: {nextRuns.map((run) => formatRun(run)).join(' · ')}
          </p>
        )
      )}
    </div>
  )
}

const DEFAULTS: Schedule = {
  frequency: 'daily',
  minute: 0,
  hour: 9,
  weekdays: [1, 2, 3, 4, 5],
  dayOfMonth: 1
}

function formatRun(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}
