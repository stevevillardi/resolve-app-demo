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

/**
 * What to call a group on screen.
 *
 * One function rather than the fallback written out at each of the places a
 * group's name is rendered, because every reader that keeps saying
 * `repoName(group.repoPath)` is a place a rename silently has no effect — and
 * nothing on screen would show that it had not.
 *
 * Trims, and reads an all-whitespace override as absent. `groups.rename`
 * refuses one at the Zod boundary already; this is what keeps a row written
 * before that from rendering as a blank sidebar entry.
 */
export function groupName(group: { name: string | null; repoPath: string }): string {
  const named = group.name?.trim()
  return named ? named : repoName(group.repoPath)
}

/**
 * What to call a Contact on screen (Phase 26 §A1).
 *
 * Every list rendered `persona?.name ?? contact.displayName`, so the *persona*
 * name won and the Contact's own name appeared nowhere outside dialogs. On a
 * profile with three repositories that is three sidebar rows all reading "Code
 * Reviewer", three routines all reading "Code Reviewer", and a command palette
 * that cannot tell them apart — which is the app's headline screen failing at
 * exactly the scale it is for.
 *
 * `displayName` is the right answer and always has been. It is NOT NULL, it
 * defaults to `derivedName()` — "Code Reviewer · checkout-service", already
 * distinguishing — a person can type their own at creation (§G4), and
 * `contacts.rename` can change it. The delete dialog and the Markdown export
 * were already reading it; the lists disagreeing with them was the bug.
 *
 * One function rather than the fallback written out at each site, for the same
 * reason `groupName` is one: every reader that keeps writing it inline is a
 * place a rename silently has no effect, and nothing on screen would show it.
 *
 * **Known limit, recorded rather than fixed.** `display_name` is a stored
 * string, not a nullable override like `groups.name`, so renaming a *persona*
 * no longer retitles the contacts bound to it — they keep the name derived from
 * what the persona used to be called. Before this the row tracked the persona
 * and could not show a typed name at all; now it shows the typed name and does
 * not track. That is the correct trade — "rename" has to mean something — and
 * persona identity stays live on the row anyway, through the avatar, which is
 * seeded from the persona id and changes face and colour with it.
 *
 * The persona is still the fallback, for the same defensive reason `groupName`
 * trims: a row written before `contacts.update` refused an empty name would
 * otherwise render as a blank sidebar entry.
 */
export function contactName(
  contact: { displayName: string },
  persona: { name: string } | undefined
): string {
  const named = contact.displayName.trim()
  return named ? named : (persona?.name ?? 'Contact')
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
