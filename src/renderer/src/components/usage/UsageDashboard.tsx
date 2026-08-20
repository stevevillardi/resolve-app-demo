import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { BarChart3, Download, Table2 } from 'lucide-react'
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
import { PaneHeader } from '@/components/common/PaneHeader'
import { PaneBody } from '@/components/common/PaneBody'
import { Section } from '@/components/common/Section'
import { StatTile } from '@/components/common/StatTile'
import { useContacts } from '@/hooks/useConversations'
import { useSaveExport } from '@/hooks/useExport'
import { exportFileName, usageToCsv } from '@/lib/export'
import { usePersonas } from '@/hooks/usePersonas'
import { useUsageEvents } from '@/hooks/useUsage'
import { repoName } from '@/lib/format'
import { aggregateUsage, formatCost, formatCostSummary, formatTokens } from '@/lib/usage'
import {
  CHART_PALETTE,
  bucketByDay,
  byModel,
  byPersona,
  byRepo,
  bySource,
  scopeFilter,
  filterUsage,
  groupUsage,
  rangeStart,
  seriesIds,
  type UsageGroup,
  type UsageMetric,
  type UsageSelector
} from '@/lib/usage-report'
import { useUiStore } from '@/store/useUiStore'
import type { UsageSource } from '@/types'

/**
 * Spend over time, on real `usage_events` rows.
 *
 * The arithmetic all lives in lib/usage-report.ts — this file picks filters,
 * calls those functions and renders. That split is not tidiness: the renderer
 * test project matches `*.test.ts` only and there is no component-render
 * harness, so anything computed in here is untestable by construction.
 */

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'all', label: 'All' }
] as const
type Range = (typeof RANGES)[number]['value']

const METRICS = [
  { value: 'cost', label: 'Spend' },
  { value: 'tokens', label: 'Tokens' }
] as const

/**
 * All four sources, not just message vs routine. `routine` is the one worth
 * singling out — the only spend nobody asked for directly — and `summary` is
 * what coordination costs, kept as its own source value specifically so this
 * screen can show it on its own.
 */
const SOURCES = [
  { value: 'all', label: 'All' },
  { value: 'message', label: 'Messages' },
  { value: 'routine', label: 'Routines' },
  { value: 'mention', label: 'Mentions' },
  { value: 'summary', label: 'Summaries' }
] as const
type SourceFilter = (typeof SOURCES)[number]['value']

const BREAKDOWNS = [
  { value: 'persona', label: 'Persona' },
  { value: 'repo', label: 'Repo' }
] as const
type Breakdown = (typeof BREAKDOWNS)[number]['value']

/**
 * One breakdown, as labelled bars.
 *
 * Direct labels always, because three of the five palette slots sit under 3:1
 * on the light surface — the relief rule from the palette's own note in
 * assets/main.css. Columns are headed because the row carries two different
 * measures: the bar is the chosen metric and the last column is always spend,
 * and an unlabelled pair of numbers invites reading the bar as dollars.
 */
function BreakdownRows({
  rows,
  metric,
  colorOf
}: {
  rows: UsageGroup[]
  metric: UsageMetric
  colorOf: (row: UsageGroup, index: number) => string
}): React.JSX.Element {
  const max = Math.max(
    ...rows.map((row) => (metric === 'cost' ? (row.cost ?? 0) : row.tokens)),
    metric === 'cost' ? 0.0001 : 1
  )

  return (
    <div className="flex flex-col gap-2.5">
      {/* The name shares the flexible width with the bar (1:2) rather than
          taking a fixed width, which truncates names at any pane width. The
          numeric columns stay fixed — tabular figures want a constant
          column. */}
      <div className="text-muted-foreground flex items-center gap-2.5 text-micro font-medium tracking-wide uppercase">
        <span className="size-5 shrink-0" aria-hidden />
        <span className="min-w-24 flex-[1_1_6rem]">Name</span>
        <span className="min-w-16 flex-[2_1_4rem]" aria-hidden />
        <span className="w-16 shrink-0 text-right">Tokens</span>
        <span className="w-16 shrink-0 text-right">Spend</span>
      </div>
      {rows.map((row, index) => {
        const value = metric === 'cost' ? (row.cost ?? 0) : row.tokens
        return (
          <div key={row.key} className="flex items-center gap-2.5">
            <AvatarColorSwatch name={row.label} color={colorOf(row, index)} size="xs" />
            <span className="min-w-24 flex-[1_1_6rem] truncate text-xs" title={row.label}>
              {row.label}
            </span>
            <div className="bg-muted h-2 min-w-16 flex-[2_1_4rem] overflow-hidden rounded-full">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max((value / max) * 100, 2)}%`,
                  backgroundColor: colorOf(row, index)
                }}
              />
            </div>
            <span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-meta tabular-nums">
              {formatTokens(row.tokens)}
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-meta tabular-nums">
              {formatCostSummary(row.summary)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function UsageDashboard(): React.JSX.Element {
  const scope = useUiStore((state) => state.usageScope)
  const [range, setRange] = useState<Range>('30')
  const [metric, setMetric] = useState<UsageMetric>('cost')
  const [source, setSource] = useState<SourceFilter>('all')
  const [breakdown, setBreakdown] = useState<Breakdown>('persona')
  const [showTable, setShowTable] = useState(false)

  const { data: events = [], isPending } = useUsageEvents()
  const { data: contacts = [] } = useContacts()
  const { data: personas = [] } = usePersonas()

  // Read once per mount rather than per render, so the buckets cannot shift
  // underneath an interaction.
  const [now] = useState(() => Date.now())

  const shown = useMemo(() => {
    const inScope = scopeFilter(contacts, scope)
    return filterUsage(events, {
      ...(range !== 'all' && { from: rangeStart(Number(range), now) }),
      ...(source !== 'all' && { sources: [source as UsageSource] })
    }).filter(inScope)
  }, [events, contacts, scope, range, source, now])

  const totals = useMemo(() => aggregateUsage(shown), [shown])

  /**
   * The honest cost data's exit door.
   *
   * `shown` rather than `events`: what leaves is what the screen is showing,
   * filters and all. The alternative — always exporting everything — makes the
   * file impossible to reconcile against the chart it came from.
   *
   * Names are resolved here rather than in the serializer because this is where
   * the contact and persona lists already are. A contact that has been deleted
   * resolves to nothing, and the empty cell is accurate: deleting a contact
   * keeps its spend and drops its name.
   */
  const { save, isPending: saving } = useSaveExport()
  const exportCsv = (): void => {
    const at = Date.now()
    save({
      suggestedName: exportFileName(`switchboard-usage-${scopeName}`, 'csv', at),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      content: usageToCsv(shown, {
        contact: (id) => contacts.find((contact) => contact.id === id)?.displayName ?? null,
        persona: (id) => personas.find((persona) => persona.id === id)?.name ?? null
      })
    })
  }

  const personaRows = useMemo(
    () => groupUsage(shown, byPersona(contacts, personas), metric),
    [shown, contacts, personas, metric]
  )
  const repoRows = useMemo(
    () => groupUsage(shown, byRepo(contacts), metric),
    [shown, contacts, metric]
  )
  const modelRows = useMemo(() => groupUsage(shown, byModel(), metric), [shown, metric])
  const sourceRows = useMemo(() => groupUsage(shown, bySource(), metric), [shown, metric])

  const routineShare = useMemo(() => {
    const total = sourceRows.reduce((sum, row) => sum + row.tokens, 0)
    const routine = sourceRows.find((row) => row.key === 'routine')?.tokens ?? 0
    return total === 0 ? 0 : Math.round((routine / total) * 100)
  }, [sourceRows])

  const chart = useMemo(() => {
    const isPersona = breakdown === 'persona'
    // Ids are assigned over every persona/repo that exists, not just those with
    // spend in range, so a series keeps its colour as the filters move.
    const ids = seriesIds(
      isPersona ? personas.map((p) => p.id) : contacts.map((contact) => contact.repoPath)
    )
    const selector: UsageSelector = isPersona ? byPersona(contacts, personas) : byRepo(contacts)
    // The chart wrapper emits `--color-<key>`, and a repo path is not a legal
    // custom-property name — so the series is keyed by id, not by path.
    const keyed: UsageSelector = (event) => {
      const bucket = selector(event)
      return { ...bucket, key: ids.get(bucket.key) ?? bucket.key }
    }

    const rows = isPersona ? personaRows : repoRows
    const config: ChartConfig = Object.fromEntries(
      rows.map((row, index) => [
        ids.get(row.key) ?? row.key,
        {
          label: row.label,
          color: isPersona
            ? (row.color ?? CHART_PALETTE[index % CHART_PALETTE.length])
            : CHART_PALETTE[index % CHART_PALETTE.length]
        }
      ])
    )

    return {
      config,
      days: bucketByDay(shown, keyed, metric),
      seriesKeys: rows.map((row) => ids.get(row.key) ?? row.key)
    }
  }, [breakdown, personas, contacts, personaRows, repoRows, shown, metric])

  const scopeName =
    scope.kind === 'all'
      ? 'All personas'
      : scope.kind === 'persona'
        ? (personas.find((p) => p.id === scope.id)?.name ?? 'Persona')
        : repoName(scope.repoPath)

  // One home for the caveat, on the figure that carries the mark. The `+` on
  // the total is the signal; this explains it, once, on demand.
  const unpricedHint =
    totals.unpricedEvents > 0
      ? `${totals.unpricedEvents} of these ${totals.unpricedEvents === 1 ? 'turn has' : 'turns have'} no published price, so the real total is a little higher.`
      : undefined

  const paletteColor = (_row: UsageGroup, index: number): string =>
    CHART_PALETTE[index % CHART_PALETTE.length]
  const personaColor = (row: UsageGroup, index: number): string =>
    row.color ?? paletteColor(row, index)
  const breakdownRows = breakdown === 'persona' ? personaRows : repoRows

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <PaneHeader
        title={scopeName}
        // Range and the table toggle only. Measure lives in the filter row
        // below instead: three controls plus a title in a 48px strip leave the
        // range options touching the table button at 1100px wide, and a header
        // that has to be read at two speeds is not a header.
        actions={
          <>
            <SegmentedControl
              options={RANGES}
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
            {/*
              Exports exactly what is on screen — the scope, the range and the
              source filter all apply — because a button on a
              filtered view that quietly saved everything would be the one kind
              of export nobody could check.
            */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={shown.length === 0 || saving}
              onClick={exportCsv}
            >
              <Download className="size-3.5" />
              CSV
            </Button>
          </>
        }
      />

      <PaneBody measure="wide">
        {/* What is being counted, and what it is being counted over. Both
            reshape every figure below them, so they belong together and above
            the tiles rather than split between here and the header. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0 text-meta font-medium tracking-wide uppercase">
              Measure
            </span>
            <SegmentedControl
              options={METRICS}
              value={metric}
              onChange={setMetric}
              aria-label="Measure"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0 text-meta font-medium tracking-wide uppercase">
              Source
            </span>
            <SegmentedControl
              options={SOURCES}
              value={source}
              onChange={setSource}
              aria-label="Usage source"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 @3xl/pane:grid-cols-4">
          <StatTile label="Spend" value={formatCostSummary(totals)} hint={unpricedHint} />
          <StatTile
            label="Tokens"
            value={formatTokens(totals.totalInputTokens + totals.totalOutputTokens)}
          />
          <StatTile
            label="Cached input"
            value={formatTokens(totals.totalCachedInputTokens ?? 0)}
            note="Charged at a lower rate"
          />
          <StatTile label="From routines" value={`${routineShare}%`} note="Unattended work" />
        </div>

        {isPending && events.length === 0 ? (
          <EmptyState loading title="Loading usage" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No usage matches these filters"
            description="Widen the time range, choose another source, or pick a different scope."
          />
        ) : showTable ? (
          <table className="w-full text-sm">
            <caption className="text-muted-foreground pb-2 text-left text-xs">
              Totals per {breakdown} over the selected range.
            </caption>
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th className="pb-1.5 font-medium">
                  {breakdown === 'persona' ? 'Persona' : 'Repo'}
                </th>
                <th className="pb-1.5 text-right font-medium">Tokens</th>
                <th className="pb-1.5 text-right font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {breakdownRows.map((row, index) => (
                <tr key={row.key} className="border-border/70 border-b last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-[3px]"
                        style={{
                          backgroundColor:
                            breakdown === 'persona'
                              ? personaColor(row, index)
                              : paletteColor(row, index)
                        }}
                      />
                      {row.label}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatTokens(row.tokens)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCostSummary(row.summary)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <Section
              title={metric === 'cost' ? 'Spend per day' : 'Tokens per day'}
              description={metric === 'cost' ? 'What each day cost.' : 'What each day sent.'}
              action={
                <SegmentedControl
                  options={BREAKDOWNS}
                  value={breakdown}
                  onChange={setBreakdown}
                  aria-label="Break down by"
                />
              }
            >
              <ChartContainer config={chart.config} className="aspect-auto h-56 w-full">
                <BarChart data={chart.days} margin={{ left: 4, right: 4, top: 4 }}>
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
                    width={48}
                    tickFormatter={(value: number) =>
                      metric === 'cost' ? formatCost(value) : formatTokens(value)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) =>
                          metric === 'cost'
                            ? formatCost(Number(value))
                            : formatTokens(Number(value))
                        }
                        indicator="dot"
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {chart.seriesKeys.map((key, index) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="usage"
                      fill={`var(--color-${key})`}
                      // A 2px surface-coloured stroke reads as a gap between
                      // stacked segments without shifting the geometry.
                      stroke="var(--background)"
                      strokeWidth={2}
                      radius={index === chart.seriesKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
            </Section>

            <Section title="Totals by persona" description="Who spent it.">
              <BreakdownRows rows={personaRows} metric={metric} colorOf={personaColor} />
            </Section>

            <Section title="Totals by repo" description="Where the work happened.">
              <BreakdownRows rows={repoRows} metric={metric} colorOf={paletteColor} />
            </Section>

            <Section
              title="Totals by model"
              description="The model that served each turn, not what its persona is set to now."
            >
              <BreakdownRows rows={modelRows} metric={metric} colorOf={paletteColor} />
            </Section>

            <Section title="Totals by source" description="What asked for the work.">
              <BreakdownRows rows={sourceRows} metric={metric} colorOf={paletteColor} />
            </Section>
          </>
        )}
      </PaneBody>
    </div>
  )
}
