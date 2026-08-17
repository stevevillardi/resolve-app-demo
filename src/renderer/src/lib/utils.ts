import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The app's five custom font sizes, declared to tailwind-merge.
 *
 * Without this, `cn('text-meta', 'text-scope-safe')` silently returns only
 * `text-scope-safe`. tailwind-merge resolves conflicts by group, and it has no
 * way to know whether an unrecognised `text-*` is a size or a colour — so it
 * puts both in the colour group and drops the earlier one. The class does not
 * appear in the output at all, nothing warns, and the element inherits 16px
 * from the body.
 *
 * That is exactly what happened when these tokens replaced `text-[11px]`:
 * bracket syntax carries a unit, so tailwind-merge could always tell it was a
 * length. A bare name cannot be guessed, and every ScopeChip in the app
 * silently jumped from 11px to 16px because the chip's colour class won.
 *
 * So: any new `--text-*` in main.css has to be added here in the same commit.
 * The pairing is not optional, and there is no build-time check for it — the
 * only symptom is text that renders at the wrong size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'meta', 'code', 'row', 'title'] }]
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
