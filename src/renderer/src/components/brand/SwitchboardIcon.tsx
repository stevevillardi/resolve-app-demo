import { cn } from '@/lib/utils'

/**
 * The app icon, inline.
 *
 * Same reasoning as BrandMarks: the mark belongs in the bundle as vector, not as
 * a third rasterised copy of resources/icon.svg. It replaced a 512px PNG that
 * cost ~146KB to display at 56 and 80 CSS pixels, and that went soft on a
 * Retina display at any size the two callers might grow into.
 *
 * Unlike the brand marks this one keeps its own colours — it is the product's
 * identity rather than an icon in running text, and it has to read the same on
 * either theme, which is why the ground is drawn rather than inherited.
 *
 * Geometry is resources/icon.svg verbatim; edit there and copy, so the packaged
 * icon and the one on the splash screen cannot drift. The squircle is drawn at
 * rx=112/512, so callers wanting the shadow to follow the shape can pass
 * `rounded-[22%]` and have it line up.
 */
export function SwitchboardIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden
      focusable="false"
      className={cn('size-16 shrink-0', className)}
    >
      <defs>
        <linearGradient id="switchboard-icon-ground" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0a1120" />
          <stop offset="100%" stopColor="#10375e" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill="url(#switchboard-icon-ground)" />
      <rect
        x="3"
        y="3"
        width="506"
        height="506"
        rx="109.5"
        fill="none"
        stroke="#1e9df1"
        strokeWidth="6"
        strokeOpacity="0.38"
      />

      <path
        d="M 170 170 L 256 256 M 342 170 L 256 256 M 170 342 L 256 256 M 342 342 L 256 256"
        stroke="#1e9df1"
        strokeWidth="14"
        strokeLinecap="round"
        strokeOpacity="0.75"
      />

      <g fill="#0c1c2e" strokeWidth="10">
        <circle cx="170" cy="170" r="28" stroke="#4fb8f7" />
        <circle cx="342" cy="170" r="28" stroke="#2ed3a7" />
        <circle cx="170" cy="342" r="28" stroke="#2ed3a7" />
        <circle cx="342" cy="342" r="28" stroke="#4fb8f7" />
      </g>
      <g>
        <circle cx="170" cy="170" r="10" fill="#4fb8f7" />
        <circle cx="342" cy="170" r="10" fill="#2ed3a7" />
        <circle cx="170" cy="342" r="10" fill="#2ed3a7" />
        <circle cx="342" cy="342" r="10" fill="#4fb8f7" />
      </g>

      <circle cx="256" cy="256" r="54" fill="#1e9df1" />
      <circle
        cx="256"
        cy="256"
        r="25"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.92"
        strokeWidth="9"
      />
    </svg>
  )
}
