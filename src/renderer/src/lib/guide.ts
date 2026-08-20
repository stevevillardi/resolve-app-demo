import { NAV_ITEMS } from './nav-items'
import { MENU_ACCELERATORS, type MenuActionId } from '../../../shared/menu'
import type { LucideIcon } from 'lucide-react'
import type { Section } from '@/store/useUiStore'

/**
 * What the resting screen teaches, worked out here rather than in the component.
 *
 * A fresh install answered with one sentence and a button would be an accurate
 * description of the state and a useless description of the app: nothing on
 * screen would say what a Contact is for, that a repo has a shared thread, that
 * work arrives on a branch rather than in the chat, or that any of the five
 * keyboard bindings exist. The nouns in this app are unusual enough that a
 * first launch has to be told them somewhere, and the one screen every launch
 * opens on — `section` is not persisted — is the place.
 *
 * Pure because the renderer Vitest project matches `*.test.ts` only, so
 * anything left in the `.tsx` cannot be covered. The two things worth being
 * sure about are the checklist's done/undone rules, which are read off four
 * unrelated queries, and the promise that every section in the rail has a
 * sentence explaining it.
 */

/** A section of the app the rail can reach, which is all of them but Home. */
export type GuideSection = Exclude<Section, 'home'>

// --- What the app is made of -------------------------------------------------

export interface GuideConcept {
  section: GuideSection
  /** The rail's own label, so the guide and the rail cannot disagree. */
  label: string
  icon: LucideIcon
  blurb: string
}

/**
 * One sentence per section, in the app's own vocabulary.
 *
 * A `Record` over the section union rather than a list, so adding a section to
 * `Section` fails to compile until somebody writes what it is for. That is the
 * whole point of the shape — the failure mode being designed against is a new
 * nav item quietly appearing in the rail and silently not appearing here.
 *
 * "Skill" is the app's injected-prose kind, never the executable Claude
 * Code / Codex kind (CLAUDE.md, "Two words that mean two things"), which is
 * why the wording says instruction text.
 */
const BLURBS: Record<GuideSection, string> = {
  chats:
    'Message one contact — a persona bound to one repository. Or open a repo group: the shared thread where everyone working in that repo posts what they decided.',
  branches:
    'Work a persona has finished in its own checkout, waiting on you. Read the diff, then merge it or open a pull request.',
  personas:
    'Who a contact is before it is bound to anything: how it should work, and what it is allowed to do — on your files, and on GitHub.',
  skills: 'Reusable instructions any persona can attach. Write the wording once and share it.',
  routines:
    'A schedule and a prompt. The contact wakes on its own, does the work while you are elsewhere, and reports back here.',
  usage: 'What every turn cost, broken down by persona, repo and model.',
  activity:
    'A record of what changed and who did it — contacts bound or renamed, repo trust granted, branches merged.'
}

/**
 * The tour, in rail order.
 *
 * Derived from NAV_ITEMS rather than re-listed, so the guide walks the rail
 * top to bottom and picks up a renamed label or a swapped icon for free. Home
 * is dropped because Home is the screen doing the explaining.
 */
export function guideConcepts(): GuideConcept[] {
  const concepts: GuideConcept[] = []
  for (const item of NAV_ITEMS) {
    if (item.section === 'home') continue
    concepts.push({
      section: item.section,
      label: item.label,
      icon: item.icon,
      blurb: BLURBS[item.section]
    })
  }
  return concepts
}

// --- The first four things to do ---------------------------------------------

export type GuideStepId = 'contact' | 'message' | 'github' | 'routine'

export interface GuideStep {
  id: GuideStepId
  title: string
  body: string
  /** Read off real state, never remembered — see `firstSteps`. */
  done: boolean
}

/**
 * Everything the checklist reads, as plain counts.
 *
 * Structural rather than the IPC output types, for the same reason
 * `authBannerFor` takes an `AuthStatusLike`: the pure layer should not have to
 * be revised because a query grew a field.
 */
export interface GuideProgress {
  contacts: number
  /** Turns that have actually happened — message previews or usage rows. */
  turns: number
  routines: number
  /** A stored token GitHub has not rejected. */
  githubConnected: boolean
  /** False without a client id, in which case the flow cannot start at all. */
  githubConfigurable: boolean
}

/**
 * The setup checklist, ordered, with each step's state read off live data.
 *
 * Nothing here is a remembered "you did this once" flag, and that is the
 * design: a step is done while the thing it produced exists, so deleting every
 * contact puts the first step back rather than leaving a permanently ticked
 * list describing a profile that no longer matches it. It also means the list
 * cannot get out of step with the app across a dev reset.
 *
 * Connecting GitHub is dropped rather than shown-and-disabled when
 * MAIN_VITE_GITHUB_CLIENT_ID is missing: a step nobody in this build can take
 * is not a step, and the Settings dialog already says why the flow is
 * unavailable.
 */
export function firstSteps(progress: GuideProgress): GuideStep[] {
  const steps: GuideStep[] = [
    {
      id: 'contact',
      title: 'Make a contact',
      body: 'Pick a persona, point it at a repository, and choose whether it works in its own checkout or in yours.',
      done: progress.contacts > 0
    },
    {
      id: 'message',
      title: 'Say something to it',
      body: 'A contact is a conversation. Ask it a question and it answers from inside that repository.',
      done: progress.turns > 0
    }
  ]

  if (progress.githubConfigurable) {
    steps.push({
      id: 'github',
      title: 'Connect GitHub',
      body: 'Optional. It lets a persona browse your repositories, read issues, and raise a pull request instead of leaving a branch behind.',
      done: progress.githubConnected
    })
  }

  steps.push({
    id: 'routine',
    title: 'Put work on a schedule',
    body: 'A routine wakes a contact on a schedule, unattended, and posts what it did to the repo group.',
    done: progress.routines > 0
  })

  return steps
}

/** The first step still outstanding, or null once the list is complete. */
export function nextStep(steps: GuideStep[]): GuideStep | null {
  return steps.find((step) => !step.done) ?? null
}

// --- Keyboard bindings -------------------------------------------------------

export interface ShortcutHint {
  keys: string
  label: string
}

/**
 * The modifier as this platform writes it.
 *
 * `undefined` while `appInfo.get` is in flight. macOS is this app's primary
 * target, so a first frame reading ⌘ is right far more often than one reading
 * Ctrl — and the query resolves before anyone finishes reading the sentence
 * next to it.
 */
export function modifierKey(platform: string | undefined): string {
  return platform === undefined || platform === 'darwin' ? '⌘' : 'Ctrl+'
}

/**
 * The *other* modifier, for the bindings that deliberately avoid ⌘.
 *
 * Same default-to-macOS reasoning as `modifierKey`. Kept as its own function
 * rather than a second branch inside that one because the two answer different
 * questions — "how does this platform write the command key" and "how does it
 * write the alt key" — and a caller wanting one never wants the other.
 */
export function altKey(platform: string | undefined): string {
  return platform === undefined || platform === 'darwin' ? '⌥' : 'Alt+'
}

/**
 * Every binding the app claims, in one list.
 *
 * They come from four unrelated places — the application menu, a capture-phase
 * listener (`useCommandPalette`), the vendored sidebar, and the list panel —
 * and until now the only inventory of them was five words in the palette's own
 * footer, which you had to already know the palette shortcut to read.
 *
 * The three the menu owns are read from `MENU_ACCELERATORS` rather than
 * retyped, so a key changed in main cannot leave this screen advertising the
 * old one. The other two are bound in the renderer and are literals here for
 * the same reason: this is where they are decided.
 */
export function shortcutHints(platform: string | undefined): ShortcutHint[] {
  const mod = modifierKey(platform)
  const alt = altKey(platform)
  const menuKey = (action: MenuActionId): string =>
    MENU_ACCELERATORS[action].replace('CmdOrCtrl+', mod)

  return [
    // Deliberately not the palette's own placeholder, which still reads "Jump
    // to or start anything…" and has undersold it since the palette grew
    // full-text message search.
    { keys: menuKey('command-palette'), label: 'Jump to anything, or search every message' },
    { keys: menuKey('new-contact'), label: 'New contact' },
    // ConversationList.tsx. ⌥ rather than ⌘ so the composer keeps ⌘↑/⌘↓ for
    // moving the caret; these are Slack's channel keys.
    { keys: `${alt}↑ ${alt}↓`, label: 'Previous or next conversation' },
    // Composer.tsx, which owns the ref and is mounted once.
    { keys: `${mod}L`, label: 'Jump to the message box' },
    // sidebar.tsx, SIDEBAR_KEYBOARD_SHORTCUT.
    { keys: `${mod}B`, label: 'Show or hide the rail' },
    { keys: menuKey('open-settings'), label: 'Settings' },
    // ListPanel.tsx, guarded so it is not stolen mid-typing.
    { keys: '/', label: 'Search the open list' }
  ]
}
