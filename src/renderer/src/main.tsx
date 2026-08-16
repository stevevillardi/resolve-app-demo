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

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside the providers on purpose: a throw from QueryClientProvider or
        TooltipProvider itself has to be caught too, and the fallback must not
        depend on anything that might be the thing that failed. */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
