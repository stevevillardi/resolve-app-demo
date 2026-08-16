export interface Routine {
  id: string
  contactId: string
  schedule: string
  prompt: string
  enabled: boolean
  lastRunAt: number | null
  lastRunSummary: string | null
}
