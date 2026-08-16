import { cn } from '@/lib/utils'

interface AvatarColorSwatchProps {
  name: string
  color: string
  size?: 'xs' | 'sm' | 'default' | 'lg'
  className?: string
}

const SIZE_CLASS: Record<NonNullable<AvatarColorSwatchProps['size']>, string> = {
  xs: 'size-5 rounded-[5px] text-[9px]',
  sm: 'size-6 rounded-md text-[10px]',
  default: 'size-8 rounded-lg text-[11px]',
  lg: 'size-11 rounded-xl text-sm'
}

function initialsFor(name: string): string {
  // Contact display names are "Persona · repo-name" — the repo half is shown
  // separately everywhere this appears, so initials come from the persona.
  const personaPart = name.split('·')[0] ?? name
  const parts = personaPart.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase()
}

function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!match) return null
  const raw = match[1]
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const channel = (offset: number): number => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/**
 * Picks the readable text colour for an arbitrary avatar colour.
 *
 * `PersonaTemplate.avatarColor` is a free-form CSS colour the user sets from a
 * colour input, so a fixed white foreground is a coin flip — on a light pick it
 * is unreadable. Anything that isn't parseable hex falls back to white, which
 * is right for the saturated mid-tones this defaults to.
 */
function readableForeground(color: string): string {
  const luminance = relativeLuminance(color)
  if (luminance === null) return '#ffffff'
  const onWhite = 1.05 / (luminance + 0.05)
  const onBlack = (luminance + 0.05) / 0.05
  return onBlack > onWhite ? '#0b0f14' : '#ffffff'
}

export function AvatarColorSwatch({
  name,
  color,
  size = 'default',
  className
}: AvatarColorSwatchProps): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold tracking-tight select-none',
        SIZE_CLASS[size],
        className
      )}
      style={{ backgroundColor: color, color: readableForeground(color) }}
    >
      {initialsFor(name)}
    </span>
  )
}
