const DAY = 86_400_000

/** Short clock time, e.g. "09:24". */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/** Sidebar-style stamp: time today, weekday this week, date beyond that. */
export function formatListTimestamp(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp)
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (timestamp >= startOfToday) return formatTime(timestamp)
  if (timestamp >= startOfToday - 6 * DAY) {
    return date.toLocaleDateString(undefined, { weekday: 'short' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Heading for a run of messages sent on the same day. */
export function formatDaySeparator(timestamp: number, now: number = Date.now()): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (timestamp >= startOfToday) return 'Today'
  if (timestamp >= startOfToday - DAY) return 'Yesterday'
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  })
}

export function isSameDay(a: number, b: number): boolean {
  const dateA = new Date(a)
  const dateB = new Date(b)
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  )
}

/** "2 hours ago" / "3 days ago" — for last-run stamps, not message logs. */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const delta = now - timestamp
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

/** Repo paths are shown in full as mono text; this is for tight rows. */
export function repoName(repoPath: string): string {
  return repoPath.split('/').filter(Boolean).pop() ?? repoPath
}

/** Strips markdown syntax down to a single readable preview line. */
export function previewLine(content: string): string {
  const firstMeaningful =
    content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('```')) ?? ''
  return firstMeaningful
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}
