/**
 * The class strings shared by every menu surface — dropdown (button-anchored)
 * and context (pointer-anchored). One file rather than two copies so the two
 * menus cannot drift: an item styled in one and not the other reads as a bug
 * to anyone who right-clicks after using the ⋯ button.
 *
 * The group name is `menu-item` (not `dropdown-menu-item`) because the
 * shortcut's focus styling has to match whichever menu the item lives in.
 */

export const menuPopupClass =
  'z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-closed:overflow-hidden ' +
  'transition-[opacity,scale] duration-100 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0'

export const menuItemClass =
  "group/menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive"

export const menuSubTriggerClass =
  "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

export const menuCheckedItemClass =
  "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

export const menuLabelClass =
  'px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7'

export const menuSeparatorClass = '-mx-1 my-1 h-px bg-border'

export const menuShortcutClass =
  'ml-auto text-xs tracking-widest text-muted-foreground group-focus/menu-item:text-accent-foreground'
