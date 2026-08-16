import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface AvatarColorSwatchProps {
  name: string
  color: string
  size?: 'default' | 'sm' | 'lg'
  className?: string
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase()
}

export function AvatarColorSwatch({
  name,
  color,
  size = 'default',
  className
}: AvatarColorSwatchProps): React.JSX.Element {
  return (
    <Avatar size={size} className={cn(className)}>
      <AvatarFallback style={{ backgroundColor: color, color: '#ffffff' }} className="font-medium">
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  )
}
