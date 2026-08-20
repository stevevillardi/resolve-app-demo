/**
 * The error for a row that has to exist and doesn't.
 *
 * These are internal invariant checks, and their messages reach the interface
 * verbatim: the IPC client strips Electron's wrapper and renders `message` as
 * written. A raw identifier in that sentence is the app talking to itself in
 * front of the user, so the id goes to the log and the sentence names the thing
 * that is gone.
 *
 * Almost always a race rather than a bug — something was deleted in another
 * window, or by a routine, between a click and the call it made. That is why
 * the wording is "no longer exists" rather than an accusation.
 */
export function notFound(subject: Subject, id?: string): Error {
  if (id) console.warn(`[not-found] ${subject} ${id}`)
  return new Error(`That ${subject} no longer exists.`)
}

type Subject = 'contact' | 'persona' | 'routine' | 'skill' | 'message' | 'group'
