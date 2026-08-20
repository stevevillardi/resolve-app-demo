/**
 * Where the persona stopped remembering.
 *
 * UnreadSeparator's shape, in the muted register rather than the accent: an
 * unread line is news and wants the eye, while this is a fact about the past
 * that should be findable without being loud.
 *
 * The wording says the consequence rather than the mechanism. "New session" is
 * a true and useless sentence — what the reader needs to know is that the
 * messages above this line are no longer in the model's memory even though they
 * are still on their screen, which is the whole tension the forever-thread
 * hides. `pending` is the same line before the fact: the resume key is cleared
 * and the next message will open the new session.
 */
export function SessionSeparator({ pending = false }: { pending?: boolean }): React.JSX.Element {
  const label = pending
    ? 'The next message starts a new session'
    : 'New session — nothing above is in memory'

  return (
    <div className="flex items-center gap-2.5 py-1" role="separator" aria-label={label}>
      <span className="bg-border h-px flex-1" aria-hidden />
      <span className="text-muted-foreground text-meta font-medium">{label}</span>
      <span className="bg-border h-px flex-1" aria-hidden />
    </div>
  )
}
