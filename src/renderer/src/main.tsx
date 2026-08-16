import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
)
