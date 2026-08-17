import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { CheckRow } from '@/components/common/CheckRow'
import type { SeedCatalog } from '@/hooks/useSeed'

/**
 * The starter-catalog choosers (Phase 17), shared between onboarding's persona
 * and skill steps and the starter library dialog.
 *
 * Both are controlled and hold no selection of their own — the parent owns
 * which ids are on, because onboarding needs the choice to survive moving
 * between steps and the library dialog needs it to survive nothing at all.
 *
 * Vocabulary note (CLAUDE.md): everything here is an app Skill — injected
 * prose. Executable repo skills never appear in a catalog.
 */

/** First sentence of the system prompt — the persona card's one-liner. */
function blurb(systemPrompt: string): string {
  const collapsed = systemPrompt.replace(/\s+/g, ' ').trim()
  const sentence = collapsed.split(/(?<=\.)\s/)[0] ?? collapsed
  return sentence.length > 110 ? `${sentence.slice(0, 109)}…` : sentence
}

export function PersonaCatalogGrid({
  catalog,
  isSelected,
  onToggle
}: {
  catalog: SeedCatalog
  isSelected: (id: string) => boolean
  onToggle: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="grid gap-2 @2xl/pane:grid-cols-2">
      {catalog.personas.map(({ entry }) => (
        <CheckRow
          key={entry.id}
          checked={isSelected(entry.id)}
          onToggle={() => onToggle(entry.id)}
          leading={
            <AvatarColorSwatch name={entry.name} color={entry.avatarColor} seed={entry.id} />
          }
          title={entry.name}
          description={
            <>
              {blurb(entry.systemPrompt)}
              <span className="mt-1 flex">
                <BackendBadge backend={entry.backend} />
              </span>
            </>
          }
        />
      ))}
    </div>
  )
}

export function SkillCatalogList({
  catalog,
  isSelected,
  onToggle,
  requiredBy
}: {
  catalog: SeedCatalog
  isSelected: (id: string) => boolean
  onToggle: (id: string) => void
  /** skill id → the chosen persona that needs it; such rows are locked on. */
  requiredBy: Map<string, string>
}): React.JSX.Element {
  return (
    <div className="grid gap-2 @2xl/pane:grid-cols-2">
      {catalog.skills.map(({ entry }) => {
        const needer = requiredBy.get(entry.id)
        return (
          <CheckRow
            key={entry.id}
            checked={isSelected(entry.id)}
            onToggle={() => onToggle(entry.id)}
            title={entry.name}
            description={entry.description}
            {...(needer ? { lockedReason: `Needed by ${needer}` } : {})}
          />
        )
      })}
    </div>
  )
}
