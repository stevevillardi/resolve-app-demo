import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { applyThemeClass } from '@/lib/theme'
import { useUiStore } from '@/store/useUiStore'
import App from './App'

// Before the first paint, not in an effect — otherwise the window flashes the
// light palette on every launch for a dark-mode user. zustand's persist
// middleware hydrates synchronously from localStorage, so the stored
// preference is already readable here.
applyThemeClass(useUiStore.getState().themePreference)

/**
 * Every read in this app is a local IPC call to our own main process.
 *
 * The default of three retries with exponential backoff is tuned for a flaky
 * network. Here there is no network: a procedure either answers or is broken,
 * and the backoff only delays the moment the list is allowed to say so — which
 * is what the lists' error state is worded for. One retry still covers the one
 * case, a read issued while main is still starting up.
 *
 * `refetchOnWindowFocus` is deliberately left **on**. It looks like pure cost
 * against a SQLite file, and it is the safety net under a known gap:
 * `contacts` and `groups` have no push channel and rely on mutation
 * callbacks, so anything that writes them outside this renderer is only ever
 * noticed on focus. Turning it off would be a governance change to how this app
 * stays fresh, not a performance tweak.
 */
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside the providers on purpose: a throw from QueryClientProvider or
        TooltipProvider itself has to be caught too, and the fallback must not
        depend on anything that might be the thing that failed. */}
    <ErrorBoundary variant="window">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
