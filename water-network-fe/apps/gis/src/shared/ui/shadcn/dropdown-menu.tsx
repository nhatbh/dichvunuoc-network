import { DropdownMenu as KDropdown } from '@kobalte/core/dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-solid'
import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const DropdownMenu = KDropdown
const DropdownMenuTrigger = KDropdown.Trigger
const DropdownMenuGroup = KDropdown.Group
const DropdownMenuSub = KDropdown.Sub
const DropdownMenuRadioGroup = KDropdown.RadioGroup

const DropdownMenuSubTrigger = (
  props: ComponentProps<typeof KDropdown.SubTrigger> & {
    class?: string
    children?: JSX.Element
    inset?: boolean
  }
) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'inset'])
  return (
    <KDropdown.SubTrigger
      class={cn(
        'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[expanded]:bg-accent',
        local.inset && 'pl-8',
        local.class
      )}
      {...rest}
    >
      {local.children}
      <ChevronRight class="ml-auto h-4 w-4" />
    </KDropdown.SubTrigger>
  )
}

const DropdownMenuSubContent = (
  props: ComponentProps<typeof KDropdown.SubContent> & { class?: string }
) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KDropdown.SubContent
      class={cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95',
        local.class
      )}
      {...rest}
    />
  )
}

const DropdownMenuContent = (
  props: ComponentProps<typeof KDropdown.Content> & { class?: string }
) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KDropdown.Portal>
      <KDropdown.Content
        class={cn(
          'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95',
          local.class
        )}
        {...rest}
      />
    </KDropdown.Portal>
  )
}

const DropdownMenuItem = (
  props: ComponentProps<typeof KDropdown.Item> & { class?: string; inset?: boolean }
) => {
  const [local, rest] = splitProps(props, ['class', 'inset'])
  return (
    <KDropdown.Item
      class={cn(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        local.inset && 'pl-8',
        local.class
      )}
      {...rest}
    />
  )
}

const DropdownMenuCheckboxItem = (
  props: ComponentProps<typeof KDropdown.CheckboxItem> & {
    class?: string
    children?: JSX.Element
  }
) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <KDropdown.CheckboxItem
      class={cn(
        'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        local.class
      )}
      {...rest}
    >
      <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <KDropdown.ItemIndicator>
          <Check class="h-4 w-4" />
        </KDropdown.ItemIndicator>
      </span>
      {local.children}
    </KDropdown.CheckboxItem>
  )
}

const DropdownMenuRadioItem = (
  props: ComponentProps<typeof KDropdown.RadioItem> & {
    class?: string
    children?: JSX.Element
  }
) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <KDropdown.RadioItem
      class={cn(
        'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        local.class
      )}
      {...rest}
    >
      <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <KDropdown.ItemIndicator>
          <Circle class="h-2 w-2 fill-current" />
        </KDropdown.ItemIndicator>
      </span>
      {local.children}
    </KDropdown.RadioItem>
  )
}

const DropdownMenuLabel = (
  props: ComponentProps<typeof KDropdown.Group> & { class?: string; inset?: boolean }
) => {
  const [local, rest] = splitProps(props, ['class', 'inset'])
  return (
    <KDropdown.GroupLabel
      class={cn('px-2 py-1.5 text-sm font-semibold', local.inset && 'pl-8', local.class)}
      {...rest}
    />
  )
}

const DropdownMenuSeparator = (
  props: ComponentProps<typeof KDropdown.Separator> & { class?: string }
) => {
  const [local, rest] = splitProps(props, ['class'])
  return <KDropdown.Separator class={cn('-mx-1 my-1 h-px bg-muted', local.class)} {...rest} />
}

const DropdownMenuShortcut = (props: ComponentProps<'span'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return <span class={cn('ml-auto text-xs tracking-widest opacity-60', local.class)} {...rest} />
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuRadioGroup,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
