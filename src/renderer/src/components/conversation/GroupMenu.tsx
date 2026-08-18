import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { GroupActionDialogs, GroupActionItems, type GroupDialogKind } from './GroupActions'
import { groupName } from '@/lib/format'
import type { Group } from '@/types'

/**
 * The ⋯ button on the group thread header (review §G5).
 *
 * `ContactMenu`'s counterpart, and as thin: the items and dialogs live in
 * `GroupActions.tsx` so this menu and the conversation row's right-click cannot
 * drift apart. The group header had no actions at all, which made it the one
 * thread in the app you could open and then do nothing to.
 */
export function GroupMenu({ group }: { group: Group }): React.JSX.Element {
  const [dialog, setDialog] = useState<GroupDialogKind | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Manage ${groupName(group)}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
          <GroupActionItems kind="dropdown" group={group} onOpen={setDialog} />
        </DropdownMenuContent>
      </DropdownMenu>

      <GroupActionDialogs group={group} open={dialog} onClose={() => setDialog(null)} />
    </>
  )
}
