import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FieldProps {
  label: string
  /** Ties the label to its control. Omit for composite controls with their own labelling. */
  htmlFor?: string
  /** One line under the control, explaining a consequence rather than restating the label. */
  hint?: React.ReactNode
  /** Replaces the hint and turns it red. */
  error?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * Label, control, and one line of consequence underneath.
 *
 * This existed as a local helper inside the persona editor while the skill and
 * routine editors hand-rolled the same three-part shape, so hint spacing and
 * error placement differed per screen. The error slot is here rather than left
 * to each caller because "where does the error go" is exactly the decision that
 * should not be remade per form.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {(error ?? hint) && (
        <p className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}
