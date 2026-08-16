import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { UsageBadge } from './UsageBadge'
import { usageForContact } from '@/lib/usage'
import { contacts, personaTemplates, usageEvents } from '@/mocks'

interface UsageDashboardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Categorical palette: first 3 slots of the dataviz skill's validated
// 8-color theme, the subset that clears all-pairs CVD/contrast checks in
// both light and dark — fine here since there are only 3 persona templates.
// Reused as-is in dark mode: these are mid-tone saturated fills behind a
// muted track, not text, so they don't need the darker-surface text steps.
const PERSONA_SERIES_COLOR = ['#2a78d6', '#eb6834', '#1baf7a']

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '$0.00'
  return `$${costUsd.toFixed(2)}`
}

export function UsageDashboard({ open, onOpenChange }: UsageDashboardProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false)

  const personaTotals = personaTemplates.map((persona, index) => {
    const personaContactIds = contacts
      .filter((c) => c.personaTemplateId === persona.id)
      .map((c) => c.id)
    const events = usageEvents.filter((e) => personaContactIds.includes(e.contactId))
    const totalCostUsd = events.reduce((sum, e) => sum + (e.costUsd ?? 0), 0)
    return {
      persona,
      totalCostUsd,
      color: PERSONA_SERIES_COLOR[index % PERSONA_SERIES_COLOR.length]
    }
  })
  const maxCost = Math.max(...personaTotals.map((p) => p.totalCostUsd), 0.01)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Usage &amp; cost</DialogTitle>
          <DialogDescription>
            Spend across personas and contacts. All-time totals from mock data.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="persona">
          <TabsList>
            <TabsTrigger value="persona">By persona</TabsTrigger>
            <TabsTrigger value="contact">By contact</TabsTrigger>
          </TabsList>

          <TabsContent value="persona" className="flex flex-col gap-3 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Total spend by persona</span>
              <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
                {showTable ? 'Show chart' : 'Show table'}
              </Button>
            </div>

            {showTable ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="pb-1 font-normal">Persona</th>
                    <th className="pb-1 text-right font-normal">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {personaTotals.map((row) => (
                    <tr key={row.persona.id} className="border-t">
                      <td className="py-1.5">{row.persona.name}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCost(row.totalCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col gap-2.5">
                {personaTotals.map((row) => (
                  <div key={row.persona.id} className="flex items-center gap-2.5">
                    <span className="w-28 shrink-0 truncate text-xs">{row.persona.name}</span>
                    <div className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max((row.totalCostUsd / maxCost) * 100, 3)}%`,
                          backgroundColor: row.color
                        }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums">
                      {formatCost(row.totalCostUsd)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="contact" className="flex flex-col gap-1 pt-3">
            {contacts.map((contact) => (
              <div key={contact.id} className="flex items-center justify-between py-1 text-sm">
                <span className="truncate">{contact.displayName}</span>
                <UsageBadge summary={usageForContact(usageEvents, contact.id)} />
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
