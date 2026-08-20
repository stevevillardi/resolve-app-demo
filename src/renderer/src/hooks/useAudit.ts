import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, onAuditChanged } from '@/lib/ipc-client'
import type { AuditEvent } from '@/types'

/**
 * Repo/contact governance history (Phase 27), mirroring useUsageEvents.
 *
 * The whole table, same as usage.list today — filtering and grouping stay
 * client-side (see lib/audit-report.ts). Invalidated on the audit-changed
 * push, which main announces from the one recordAuditEvent chokepoint, so a
 * background write (a routine binding a worktree, a reconciliation at turn
 * end) reaches this list without a manual refresh.
 */

export const auditKey = ['audit'] as const

export function useAuditEvents(): UseQueryResult<AuditEvent[]> {
  const queryClient = useQueryClient()

  useEffect(
    () => onAuditChanged(() => void queryClient.invalidateQueries({ queryKey: auditKey })),
    [queryClient]
  )

  return useQuery({
    queryKey: auditKey,
    queryFn: () => callProcedure('audit.list', undefined)
  })
}
