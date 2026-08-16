import * as React from 'react'

const MOBILE_BREAKPOINT = 768

const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return window.matchMedia(query).matches
}

// shadcn ships this as a useState+useEffect pair, which trips
// react-hooks/set-state-in-effect (setState synchronously inside an effect).
// useSyncExternalStore is the correct primitive for reading an external
// subscription like matchMedia, and it has no first-render `undefined` gap.
//
// Note: the window's minWidth is 940 (src/main/index.ts), so this is always
// false in practice — it exists because components/ui/sidebar.tsx depends on it.
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
