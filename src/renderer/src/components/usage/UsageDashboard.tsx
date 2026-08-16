import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { BarChart3, Table2 } from 'lucide-react'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { Button } from '@/components/ui/button'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { EmptyState } from '@/components/common/EmptyState'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatCost, formatTokens } from '@/lib/usage'
import { contacts, personaTemplates, usageEvents } from '@/mocks'
import { useUiStore } from '@/store/useUiStore'
import type { PersonaTemplate, UsageEvent } from '@/types'

const DAY = 86_400_000
const RANGES = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: 'all', label: 'All' }
] as const
type Range = (typeof RANGES)[number]['value']

/** Latest timestamp in the fixture set — "now" for a static dataset. */
const LATEST = usageEvents.reduce((max, event) => Math.max(max, event.timestamp), 0)

function personaOf(event: UsageEvent): PersonaTemplate | undefined {
  const contact = contacts.find((c) => c.id === event.contactId)
  return personaTemplates.find((p) => p.id === contact?.personaTemplateId)
}

function StatTile({
  label,
  value,
  note
}: {
  label: string
  value: string
  note?: string
}): React.JSX.Element {
  return (
    <div className="border-border rounded-lg border p-3">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl tabular-nums">{value}</p>
      {note && <p className="text-muted-foreground mt-0.5 text-[11px]">{note}</p>}
    </div>
  )
}

export function UsageDashboard(): React.JSX.Element {
  const scope = useUiStore((state) => state.usageScope)
  const [range, setRange] = useState<Range>('14')
  const [showTable, setShowTable] = useState(false)

  const scopedPersonas = useMemo(
    () =>
      scope.kind === 'all'
        ? personaTemplates
        : personaTemplates.filter((persona) => persona.id === scope.id),
    [scope]
  )

  const events = useMemo(() => {
    const cutoff = range === 'all' ? 0 : LATEST - (Number(range) - 1) * DAY
    const allowed = new Set(scopedPersonas.map((persona) => persona.id))
    return usageEvents.filter((event) => {
      if (event.timestamp < cutoff) return false
      const persona = personaOf(event)
      return persona ? allowed.has(persona.id) : false
    })
  }, [range, scopedPersonas])

  const totals = useMemo(() => {
    let cost = 0
    let hasCost = false
    let input = 0
    let output = 0
    let cached = 0
    let routineTokens = 0
    for (const event of events) {
      if (event.costUsd !== null) {
        cost += event.costUsd
        hasCost = true
      }
      input += event.inputTokens
      output += event.outputTokens
      cached += event.cachedInputTokens ?? 0
      if (event.source === 'routine') routineTokens += event.inputTokens + event.outputTokens
    }
    const tokens = input + output
    return {
      cost: hasCost ? cost : null,
      tokens,
      cached,
      routineShare: tokens === 0 ? 0 : Math.round((routineTokens / tokens) * 100)
    }
  }, [events])

  // Colour follows the persona, never its rank — the same template is the same
  // hue whether or not it appears in the current range (dataviz: identity, not
  // ordering). These are the avatar colours, so the chart and the sidebar agree.
  const chartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        scopedPersonas.map((persona) => [
          persona.id,
          { label: persona.name, color: persona.avatarColor }
        ])
      ),
    [scopedPersonas]
  )

  const daily = useMemo(() => {
    const buckets = new Map<number, Record<string, number>>()
    for (const event of events) {
      const persona = personaOf(event)
      if (!persona) continue
      const dayStart = new Date(event.timestamp).setHours(0, 0, 0, 0)
      const bucket = buckets.get(dayStart) ?? {}
      bucket[persona.id] = (bucket[persona.id] ?? 0) + event.inputTokens + event.outputTokens
      buckets.set(dayStart, bucket)
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([dayStart, byPersona]) => ({
        day: dayStart,
        label: new Date(dayStart).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        }),
        ...byPersona
      }))
  }, [events])

  const byPersona = useMemo(
    () =>
      scopedPersonas
        .map((persona) => {
          const personaEvents = events.filter((event) => personaOf(event)?.id === persona.id)
          const withCost = personaEvents.filter((event) => event.costUsd !== null)
          return {
            persona,
            cost: withCost.length
              ? withCost.reduce((sum, event) => sum + (event.costUsd ?? 0), 0)
              : null,
            tokens: personaEvents.reduce(
              (sum, event) => sum + event.inputTokens + event.outputTokens,
              0
            )
          }
        })
        .sort((a, b) => b.tokens - a.tokens),
    [events, scopedPersonas]
  )

  // Codex reports tokens but no dollar figure (blueprint §3). Naming the
  // personas that are missing from the spend total is more useful than
  // silently showing them as $0.
  const costless = byPersona.filter((row) => row.cost === null && row.tokens > 0)
  const maxTokens = Math.max(...byPersona.map((row) => row.tokens), 1)
  const scopeName =
    scope.kind === 'all'
      ? 'All personas'
      : (personaTemplates.find((p) => p.id === scope.id)?.name ?? 'Persona')

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <header className="border-border drag-region flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="truncate text-sm font-semibold tracking-tight">{scopeName}</h1>
        <div className="no-drag ml-auto flex items-center gap-2">
          <SegmentedControl
            options={RANGES.map((option) => ({ ...option }))}
            value={range}
            onChange={setRange}
            aria-label="Time range"
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowTable((value) => !value)}
          >
            {showTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
            {showTable ? 'Charts' : 'Table'}
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Reported spend"
              value={formatCost(totals.cost)}
              note={costless.length ? `${costless.length} persona not reporting` : undefined}
            />
            <StatTile label="Tokens" value={formatTokens(totals.tokens)} />
            <StatTile
              label="Cached input"
              value={formatTokens(totals.cached)}
              note="Billed at a reduced rate"
            />
            <StatTile
              label="From routines"
              value={`${totals.routineShare}%`}
              note="Unattended work"
            />
          </div>

          {events.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No usage in this range"
              description="Widen the time range or pick a different persona."
            />
          ) : showTable ? (
            <table className="w-full text-sm">
              <caption className="text-muted-foreground pb-2 text-left text-xs">
                Totals per persona over the selected range.
              </caption>
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-xs">
                  <th className="pb-1.5 font-medium">Persona</th>
                  <th className="pb-1.5 text-right font-medium">Tokens</th>
                  <th className="pb-1.5 text-right font-medium">Reported spend</th>
                </tr>
              </thead>
              <tbody>
                {byPersona.map((row) => (
                  <tr key={row.persona.id} className="border-border/70 border-b last:border-0">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: row.persona.avatarColor }}
                        />
                        {row.persona.name}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {formatTokens(row.tokens)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {formatCost(row.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Tokens per day</h2>
                  <p className="text-muted-foreground text-xs">
                    Stacked by persona. Tokens rather than dollars, so both backends are
                    represented.
                  </p>
                </div>
                <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
                  <BarChart data={daily} margin={{ left: 4, right: 4, top: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={16}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      tickFormatter={(value: number) => formatTokens(value)}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => formatTokens(Number(value))}
                          indicator="dot"
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    {scopedPersonas.map((persona, index) => (
                      <Bar
                        key={persona.id}
                        dataKey={persona.id}
                        stackId="tokens"
                        fill={`var(--color-${persona.id})`}
                        // A 2px surface-coloured stroke reads as a gap between
                        // stacked segments without shifting the geometry.
                        stroke="var(--background)"
                        strokeWidth={2}
                        radius={index === scopedPersonas.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
              </section>

              <section className="flex flex-col gap-2">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Totals by persona</h2>
                  <p className="text-muted-foreground text-xs">
                    {costless.length > 0
                      ? `Bars show tokens, which both backends report. ${costless.map((row) => row.persona.name).join(', ')} runs on Codex, which reports no cost figure.`
                      : 'Bars show tokens. Every persona in this range also reports a cost.'}
                  </p>
                </div>
                {/* Column headers, because the row carries two different
                    measures — the bar is tokens, the last column is dollars,
                    and an unlabelled pair of numbers invites reading the bar
                    as spend. */}
                <div className="text-muted-foreground flex items-center gap-2.5 text-[10px] font-medium tracking-wide uppercase">
                  <span className="size-5 shrink-0" aria-hidden />
                  <span className="w-28 shrink-0">Persona</span>
                  <span className="min-w-0 flex-1" aria-hidden />
                  <span className="w-16 shrink-0 text-right">Tokens</span>
                  <span className="w-14 shrink-0 text-right">Spend</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {byPersona.map((row) => (
                    <div key={row.persona.id} className="flex items-center gap-2.5">
                      <AvatarColorSwatch
                        name={row.persona.name}
                        color={row.persona.avatarColor}
                        size="xs"
                      />
                      <span className="w-28 shrink-0 truncate text-xs">{row.persona.name}</span>
                      <div className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max((row.tokens / maxTokens) * 100, 2)}%`,
                            backgroundColor: row.persona.avatarColor
                          }}
                        />
                      </div>
                      {/* Direct labels, always — three of the five palette
                          slots sit under 3:1 on the light surface, so the
                          relief rule applies. */}
                      <span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-[11px] tabular-nums">
                        {formatTokens(row.tokens)}
                      </span>
                      <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums">
                        {formatCost(row.cost)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
