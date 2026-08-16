/**
 * Both thread views' header is just the shared pane header.
 *
 * Kept as its own name because a thread's subtitle is always a repo path and
 * both props are required here, which is a narrower contract than the general
 * pane header offers.
 */
import { PaneHeader } from '@/components/common/PaneHeader'

interface ThreadHeaderProps {
  leading: React.ReactNode
  title: string
  subtitle: string
  /** The full repo path, when `subtitle` is only its last segment. */
  subtitleTitle?: string
  actions?: React.ReactNode
  className?: string
}

export function ThreadHeader(props: ThreadHeaderProps): React.JSX.Element {
  return <PaneHeader {...props} />
}
