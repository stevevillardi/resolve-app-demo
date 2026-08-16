import { useState } from 'react'
import { BookOpen, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { skills as initialSkills } from '@/mocks'
import type { Skill } from '@/types'

interface SkillLibraryViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SkillLibraryView({ open, onOpenChange }: SkillLibraryViewProps): React.JSX.Element {
  const [skills, setSkills] = useState<Skill[]>(initialSkills)
  const [detail, setDetail] = useState<Skill | null>(null)

  const removeSkill = (id: string): void => setSkills((prev) => prev.filter((s) => s.id !== id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4" />
            Skill library
          </DialogTitle>
          <DialogDescription>Reusable instructions any persona can attach.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setDetail(skill)}
              >
                <p className="truncate text-sm font-medium">{skill.name}</p>
                <p className="text-muted-foreground truncate text-xs">{skill.description}</p>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Delete skill"
                onClick={() => removeSkill(skill.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" className="gap-1.5">
            <Plus className="size-3.5" />
            New skill
          </Button>
        </DialogFooter>
      </DialogContent>

      {detail && (
        <Dialog open={Boolean(detail)} onOpenChange={(next) => !next && setDetail(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{detail.name}</DialogTitle>
              <DialogDescription>{detail.description}</DialogDescription>
            </DialogHeader>
            <Separator />
            <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
              {detail.content}
            </pre>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  )
}
