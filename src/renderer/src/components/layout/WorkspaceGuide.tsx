import { useState } from 'react'
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  LibraryBig,
  MessageSquarePlus,
  Plus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
// lucide 1.x dropped brand marks, so the GitHub logo is inlined in the repo.
import { Github } from '@/components/github/GithubMark'
import { KeyHint } from '@/components/common/KeyHint'
import { ListRow } from '@/components/common/ListRow'
import { PaneBody } from '@/components/common/PaneBody'
import { PANE_STRIP } from '@/components/common/PaneHeader'
import { Section } from '@/components/common/Section'
import { StarterLibraryDialog } from '@/components/onboarding/StarterLibraryDialog'
import { SwitchboardIcon } from '@/components/brand/SwitchboardIcon'
import { useAppInfo } from '@/hooks/useSettings'
import { openExternal, useAuthStatus } from '@/hooks/useAuth'
import { useContacts } from '@/hooks/useConversations'
import { useMessagePreviews } from '@/hooks/useMessages'
import { useRoutines } from '@/hooks/useRoutines'
import {
  firstSteps,
  guideConcepts,
  modifierKey,
  nextStep,
  shortcutHints,
  type GuideStep,
  type GuideStepId
} from '@/lib/guide'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/useUiStore'
import { DOCS_URL } from '../../../../shared/menu'

/**
 * The screen that explains the app.
 *
 * Home is where every launch lands (`section` is not persisted) and where a
 * fresh install lands twice over, and until now it answered both with a
 * centred sentence and one button. The sentence was accurate and taught
 * nothing: this app's nouns are not guessable from a chat window. A Contact is
 * a persona *bound to a repository*; a repo has a group thread nobody has a
 * session in; finished work arrives on a git branch rather than in the reply;
 * and there are five keyboard bindings whose only inventory was inside the
 * palette you needed one of them to open.
 *
 * Two shapes, because a first launch and a fifth week want different amounts
 * of this:
 *
 * `WorkspaceGuide` is the whole pane, for Home with nothing to summarise —
 * masthead, the setup checklist, the tour, the shortcuts.
 * `GuideStrip` is the tour and the shortcuts as one collapsible section, for
 * Home once it has real content to lead with. Same content, no masthead and no
 * checklist, folded away by default for anyone who has read it once.
 *
 * Every row here goes somewhere. A guide whose entries are prose you cannot
 * act on is a manual, and a manual belongs behind the Help menu.
 */

/** Which action a checklist row performs, keyed by the step it belongs to. */
interface StepAction {
  /**
   * Widened from `LucideIcon` so the inlined `Github` mark fits the same slot —
   * the marks follow lucide's contract (`className`, `aria-hidden`) precisely so
   * they can, and the GitHub step deserves GitHub's own logo rather than a
   * stand-in glyph.
   */
  icon: React.ComponentType<{ className?: string }>
  /** Printed on the right of the row while the step is outstanding. */
  keys?: string
  run: () => void
}

function useStepActions(): Record<GuideStepId, StepAction> {
  const setDialog = useUiStore((state) => state.setDialog)
  const setSection = useUiStore((state) => state.setSection)
  const { data: appInfo } = useAppInfo()
  const mod = modifierKey(appInfo?.platform)

  return {
    contact: { icon: Plus, keys: `${mod}N`, run: () => setDialog('newContact') },
    message: { icon: MessageSquarePlus, run: () => setSection('chats') },
    github: { icon: Github, run: () => setDialog('github') },
    routine: { icon: CalendarClock, run: () => setSection('routines') }
  }
}

/**
 * One step of the checklist.
 *
 * `ListRow` with `active={false}` throughout, the same way Home's branches and
 * scheduled rows use it: these are actions, not a selection, and one of them
 * being "current" is carried by the ring on the next outstanding step rather
 * than by the accent fill that means "this is what the detail pane is showing".
 */
function StepRow({
  step,
  action,
  isNext
}: {
  step: GuideStep
  action: StepAction
  isNext: boolean
}): React.JSX.Element {
  const Icon = action.icon
  return (
    <ListRow
      active={false}
      bordered
      onSelect={action.run}
      className={cn(isNext && 'border-primary/50')}
      leading={
        <span
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
            step.done
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-input text-muted-foreground'
          )}
        >
          {step.done ? <Check className="size-3" /> : <Icon className="size-3" />}
        </span>
      }
      trailing={
        step.done ? undefined : action.keys ? (
          <KeyHint className="mt-0.5">{action.keys}</KeyHint>
        ) : (
          <ChevronRight className="text-muted-foreground mt-1 size-3.5 shrink-0" />
        )
      }
    >
      <span
        className={cn(
          'block truncate text-row font-medium',
          // Done is struck through rather than hidden: the list is the shape of
          // the app's setup, and a five-item list that shrinks to two tells a
          // newcomer nothing about what the other three were.
          step.done && 'text-muted-foreground line-through'
        )}
      >
        {step.title}
      </span>
      <span className="text-muted-foreground mt-0.5 block text-xs text-pretty">{step.body}</span>
    </ListRow>
  )
}

/** The tour of the rail — one clickable row per section, in rail order. */
function ConceptGrid(): React.JSX.Element {
  const setSection = useUiStore((state) => state.setSection)
  return (
    <div className="grid gap-1.5 @3xl/pane:grid-cols-2 @6xl/pane:grid-cols-3">
      {guideConcepts().map((concept) => (
        <ListRow
          key={concept.section}
          active={false}
          bordered
          onSelect={() => setSection(concept.section)}
          leading={<concept.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />}
          trailing={
            <ChevronRight className="text-muted-foreground mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          }
        >
          <span className="block truncate text-row font-medium">{concept.label}</span>
          <span className="text-muted-foreground mt-0.5 block text-xs text-pretty">
            {concept.blurb}
          </span>
        </ListRow>
      ))}
    </div>
  )
}

/** Every binding the app claims, wrapping onto as many lines as the pane needs. */
function ShortcutRow(): React.JSX.Element {
  const { data: appInfo } = useAppInfo()
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      {shortcutHints(appInfo?.platform).map((hint) => (
        <span key={hint.keys} className="flex items-center gap-1.5">
          <KeyHint>{hint.keys}</KeyHint>
          {hint.label}
        </span>
      ))}
    </div>
  )
}

/** The two entrances that are neither a section nor a step. */
function GuideFooterActions(): React.JSX.Element {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const setDialog = useUiStore((state) => state.setDialog)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setDialog('command')}>
        <Command />
        Open the command palette
      </Button>
      {/* The same dialog Personas and Skills offer, reachable from the screen a
          launch opens on — a starter persona is the fastest way to have
          something worth binding to a repo. */}
      <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
        <LibraryBig />
        Browse the starter library
      </Button>
      <Button variant="ghost" size="sm" onClick={() => openExternal(DOCS_URL)}>
        Documentation
        <ArrowUpRight />
      </Button>
      <StarterLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />
    </div>
  )
}

/** The checklist plus its heading, or nothing at all once every step is done. */
function FirstSteps(): React.JSX.Element | null {
  const actions = useStepActions()
  const { data: contacts = [] } = useContacts()
  const { data: previews = [] } = useMessagePreviews()
  const { data: routines = [] } = useRoutines()
  const { data: authStatus } = useAuthStatus()

  const github = authStatus?.github
  const steps = firstSteps({
    contacts: contacts.length,
    turns: previews.length,
    routines: routines.length,
    // `connected` alone is a stored file, not a working token — the exact
    // conflation `tokenState` was added to end (Phase 16).
    githubConnected:
      (github?.connected ?? false) &&
      github?.tokenState !== 'rejected' &&
      github?.tokenState !== 'locked',
    githubConfigurable: github?.configured ?? false
  })

  const next = nextStep(steps)
  const done = steps.filter((step) => step.done).length

  return (
    <Section
      title="First steps"
      description={
        // Three registers rather than one sentence with a fraction in it:
        // "4 of 4 left" on a fresh install is arithmetic where a welcome
        // belongs, and "0 done" is worse.
        done === 0
          ? 'Each one opens where it happens.'
          : done === steps.length
            ? 'All done. Everything below is where the app keeps things.'
            : `${done} of ${steps.length} done. Each one opens where it happens.`
      }
    >
      <div className="grid gap-1.5 @3xl/pane:grid-cols-2">
        {steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            action={actions[step.id]}
            isNext={next?.id === step.id}
          />
        ))}
      </div>
    </Section>
  )
}

/**
 * The full guide, as its own pane.
 *
 * Chrome is `PANE_STRIP` + `PaneBody`, matching `EmptyPane` — the strip stands
 * in for the `PaneHeader` that is not there, and it has to be the shared
 * constant rather than a local copy for the reason EmptyPane documents at
 * length: this pane abuts the nav rail, so a background that differs by one
 * token reopens the seam under the green traffic light.
 */
export function WorkspaceGuide(): React.JSX.Element {
  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className={PANE_STRIP} />
      <PaneBody measure="wide">
        <div className="flex items-start gap-4">
          <SwitchboardIcon className="size-12 rounded-[22%] shadow-sm" />
          <div className="min-w-0">
            <h1 className="text-title font-semibold tracking-tight">Switchboard</h1>
            <p className="text-muted-foreground max-w-prose text-sm text-pretty">
              A console for a fleet of coding personas. Each one is bound to a repository, works
              under permissions you set, and reports back here.
            </p>
          </div>
        </div>

        <FirstSteps />

        <Section title="What is where" description="The rail, top to bottom.">
          <ConceptGrid />
        </Section>

        <Section title="Keyboard">
          <ShortcutRow />
        </Section>

        <GuideFooterActions />
      </PaneBody>
    </div>
  )
}

/**
 * The same tour, folded into one section under a Home that has content.
 *
 * Open by default and collapsible, persisted in `useUiStore` — the summary
 * above it is the reason to be on this screen, and a permanent block of
 * explanation under it would be the thing you scroll past forever. Collapsed it
 * is one heading and a chevron, which is also the only way back to it, so
 * hiding the tour can never lose it.
 */
export function GuideStrip(): React.JSX.Element {
  const open = useUiStore((state) => state.homeGuideOpen)
  const setOpen = useUiStore((state) => state.setHomeGuideOpen)

  return (
    <Section
      title="What is where"
      {...(open ? { description: 'The rail, top to bottom, and the keys that skip it.' } : {})}
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Hide the guide' : 'Show the guide'}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
          {open ? 'Hide' : 'Show'}
        </Button>
      }
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <ConceptGrid />
          <ShortcutRow />
          <GuideFooterActions />
        </div>
      ) : (
        // `Section` requires children, and an empty fragment keeps its gap from
        // collapsing the heading onto whatever follows.
        <></>
      )}
    </Section>
  )
}
