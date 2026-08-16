import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'
import type { AuthStatus, DeviceFlowState } from '../../../shared/ipc-contract'

/**
 * Auth state for the renderer (Phase 3). Everything here reads through the
 * IPC layer — the renderer never sees a token, only whether one exists.
 */

export const authStatusKey = ['auth', 'status'] as const
const codexLoginKey = ['codex', 'loginState'] as const
const githubDeviceFlowKey = ['github', 'deviceFlowState'] as const

/** How often an in-flight device flow is re-checked. Fast enough to feel live. */
const FLOW_POLL_MS = 1500

export function useAuthStatus(): UseQueryResult<AuthStatus> {
  return useQuery({
    queryKey: authStatusKey,
    queryFn: () => callProcedure('auth.getStatus', undefined),
    // Probing Claude auth spawns a subprocess, so don't re-run it on every
    // window focus — the flows below invalidate explicitly when it matters.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false
  })
}

function isFlowRunning(state: DeviceFlowState | undefined): boolean {
  return state?.status === 'starting' || state?.status === 'awaiting_authorization'
}

/**
 * Shared shape for the two device-code logins. Main holds the real flow state;
 * the renderer polls it while it's running and refreshes auth status when it
 * lands, so there's no second source of truth to keep in sync.
 */
function useDeviceFlow(
  queryKey: readonly string[],
  procedures: {
    get: () => Promise<DeviceFlowState>
    start: () => Promise<DeviceFlowState>
    cancel: () => Promise<DeviceFlowState>
  }
): {
  state: DeviceFlowState
  start: () => void
  cancel: () => void
  isStarting: boolean
} {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey,
    queryFn: procedures.get,
    refetchInterval: (query) => (isFlowRunning(query.state.data) ? FLOW_POLL_MS : false),
    refetchOnWindowFocus: false,
    retry: false
  })

  const state: DeviceFlowState = data ?? { status: 'idle' }

  const write = (next: DeviceFlowState): void => {
    queryClient.setQueryData(queryKey, next)
    if (next.status === 'success') void queryClient.invalidateQueries({ queryKey: authStatusKey })
  }

  const startMutation = useMutation({ mutationFn: procedures.start, onSuccess: write })
  const cancelMutation = useMutation({ mutationFn: procedures.cancel, onSuccess: write })

  // Polling — not the mutation — is what observes a flow completing, so refresh
  // auth status here rather than making every caller remember to do it.
  useEffect(() => {
    if (state.status !== 'success') return
    void queryClient.invalidateQueries({ queryKey: authStatusKey })
  }, [state.status, queryClient])

  return {
    state,
    start: () => startMutation.mutate(),
    cancel: () => cancelMutation.mutate(),
    isStarting: startMutation.isPending
  }
}

export function useGitHubDeviceFlow(): ReturnType<typeof useDeviceFlow> {
  return useDeviceFlow(githubDeviceFlowKey, {
    get: () => callProcedure('github.getDeviceFlowState', undefined),
    start: () => callProcedure('github.startDeviceFlow', undefined),
    cancel: () => callProcedure('github.cancelDeviceFlow', undefined)
  })
}

export function useCodexLogin(): ReturnType<typeof useDeviceFlow> {
  return useDeviceFlow(codexLoginKey, {
    get: () => callProcedure('codex.getLoginState', undefined),
    start: () => callProcedure('codex.startLogin', undefined),
    cancel: () => callProcedure('codex.cancelLogin', undefined)
  })
}

export function useSetAnthropicApiKey(): ReturnType<typeof useApiKeyMutation> {
  return useApiKeyMutation('auth.setAnthropicApiKey')
}

export function useSetOpenAiApiKey(): ReturnType<typeof useApiKeyMutation> {
  return useApiKeyMutation('auth.setOpenAiApiKey')
}

function useApiKeyMutation(procedure: 'auth.setAnthropicApiKey' | 'auth.setOpenAiApiKey'): {
  submit: (apiKey: string) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (apiKey: string) => callProcedure(procedure, { apiKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authStatusKey })
  })

  return {
    submit: (apiKey: string) => mutation.mutate(apiKey),
    isPending: mutation.isPending,
    // Surface both a thrown error and a rejection the service reported in-band.
    error:
      (mutation.error instanceof Error ? mutation.error.message : null) ??
      mutation.data?.error ??
      null
  }
}

export function useDisconnectGitHub(): { disconnect: () => void; isPending: boolean } {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => callProcedure('github.disconnect', undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authStatusKey })
  })
  return { disconnect: () => mutation.mutate(), isPending: mutation.isPending }
}

export function useCompleteOnboarding(): { complete: () => void; isPending: boolean } {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => callProcedure('auth.completeOnboarding', undefined),
    onSuccess: (status) => queryClient.setQueryData(authStatusKey, status)
  })
  return { complete: () => mutation.mutate(), isPending: mutation.isPending }
}

/** Opens a verification URL in the real browser (host-allowlisted in main). */
export function openExternal(url: string): void {
  void callProcedure('shell.openExternal', { url })
}
