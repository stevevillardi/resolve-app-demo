import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useUiStore } from '@/store/useUiStore'

/**
 * The app's one toast outlet, mounted once in App.
 *
 * Usage policy: toasts confirm transient actions whose result is
 * not otherwise on screen — copied, rebound, run started. Form validation and
 * turn failures stay inline where the user is already looking; a toast that
 * duplicates an inline error just says the same bad news twice.
 */
export function Toaster(props: ToasterProps): React.JSX.Element {
  // The store's preference maps 1:1 onto sonner's theme values, including
  // 'system' — no need to resolve the media query ourselves.
  const theme = useUiStore((state) => state.themePreference)

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
