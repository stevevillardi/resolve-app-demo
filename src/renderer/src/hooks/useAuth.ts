import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'
import type { AuthStatus, DeviceFlowState } from '../../../shared/ipc-contract'

/**
 * Auth state for the renderer. Everything here reads through the IPC layer —
 * the renderer never sees a token, only whether one exists.
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

/**
 * Forces a fresh probe of both backends and writes the answer into the shared
 * cache entry. This is the deliberate, user-visible version of `auth.getStatus`
 * — a Claude subprocess plus a Codex CLI spawn — so it hangs off an explicit
 * Retry affordance rather than any automatic refetch.
 */
export function useRefreshAuth(): { refresh: () => void; isPending: boolean } {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => callProcedure('auth.refresh', undefined),
    onSuccess: (status) => queryClient.setQueryData(authStatusKey, status)
  })
  return { refresh: () => mutation.mutate(), isPending: mutation.isPending }
}

/**
 * Re-probes on window focus, but only while a probe has *admitted failure* —
 * `claude.error` / `codex.error` mark "couldn't check", not "logged out".
 *
 * That scoping is the point: a healthy status never pays for a focus-triggered
 * subprocess, and a clean logged-out answer is respected rather than nagged.
 * The one state worth retrying automatically is the false negative this exists
 * to heal — a probe that timed out against a cold binary at launch and would
 * succeed now.
 */
export function useAuthRecoveryOnFocus(): void {
  const queryClient = useQueryClient()
  const { refresh, isPending } = useRefreshAuth()

  useEffect(() => {
    const onFocus = (): void => {
      const status = queryClient.getQueryData<AuthStatus>(authStatusKey)
      const detectionFailed = Boolean(status?.claude.error ?? status?.codex.error)
      if (detectionFailed && !isPending) refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [queryClient, refresh, isPending])
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

export function useClearAnthropicKey(): { clear: () => void; isPending: boolean } {
  return useClearKeyMutation('auth.clearAnthropicKey', 'claude')
}

export function useClearOpenAiKey(): { clear: () => void; isPending: boolean } {
  return useClearKeyMutation('auth.clearOpenAiKey', 'codex')
}

/**
 * Key removal (settings). The procedure returns only its backend's fresh
 * status, patched into the shared cache entry — same reasoning as
 * useVerifyGitHubNow: the other backends' probes were not consulted and there
 * is no reason to pay for them because one key was removed.
 */
function useClearKeyMutation(
  procedure: 'auth.clearAnthropicKey' | 'auth.clearOpenAiKey',
  slice: 'claude' | 'codex'
): { clear: () => void; isPending: boolean } {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => callProcedure(procedure, undefined),
    onSuccess: (status) =>
      queryClient.setQueryData(authStatusKey, (previous: AuthStatus | undefined) =>
        previous ? { ...previous, [slice]: status } : previous
      )
  })
  return { clear: () => mutation.mutate(), isPending: mutation.isPending }
}

/**
 * Asks GitHub whether the stored token still works — at launch, and whenever
 * the window regains focus.
 *
 * Focus is the right trigger and not an arbitrary one: revoking a token happens
 * on github.com, in a browser, which means the user leaves this window and
 * comes back. Polling on a timer would cost a request a minute to catch a thing
 * that happens twice a year.
 *
 * `auth.getStatus` deliberately stays out of this. It is synchronous and shells
 * out to probe Claude auth, which is why it carries `staleTime: Infinity`; this
 * writes the fresh GitHub half into the same cache entry rather than
 * invalidating it and paying for the other half again.
 */
export function useVerifyGitHub(): void {
  const verify = useVerifyGitHubNow()

  useEffect(() => {
    verify()
    window.addEventListener('focus', verify)
    return () => window.removeEventListener('focus', verify)
  }, [verify])
}

/**
 * The same check, on demand — for the places that have just been told by a
 * failing request that something is wrong.
 *
 * Without this the sidebar would keep its healthy dot until the next window
 * focus, which is the wrong moment: the user is looking at "couldn't load your
 * repositories" *now*, and the rail two inches away still says everything is
 * fine.
 */
export function useVerifyGitHubNow(): () => void {
  const queryClient = useQueryClient()

  return useCallback(() => {
    void callProcedure('github.verify', undefined).then((github) => {
      // Patched into the existing entry rather than invalidated: `auth.getStatus`
      // shells out to probe Claude auth, and there is no reason to pay for that
      // because GitHub answered.
      queryClient.setQueryData(authStatusKey, (previous: AuthStatus | undefined) =>
        previous ? { ...previous, github } : previous
      )
    })
  }, [queryClient])
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
