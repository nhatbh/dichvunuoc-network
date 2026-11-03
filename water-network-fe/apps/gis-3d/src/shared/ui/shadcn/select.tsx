import { Select as KSelect } from '@kobalte/core/select'
import { Check, ChevronDown } from 'lucide-solid'
import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const Select = KSelect
const SelectValue = KSelect.Value
const SelectHiddenSelect = KSelect.HiddenSelect

interface SelectTriggerProps extends ComponentProps<typeof KSelect.Trigger> {
  class?: string
  children?: JSX.Element
}
const SelectTrigger = (props: SelectTriggerProps) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <KSelect.Trigger
      class={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
        local.class
      )}
      {...rest}
    >
      {local.children}
      <KSelect.Icon class="ml-2 h-4 w-4 opacity-50">
        <ChevronDown />
      </KSelect.Icon>
    </KSelect.Trigger>
  )
}

interface SelectContentProps extends ComponentProps<typeof KSelect.Content> {
  class?: string
}
const SelectContent = (props: SelectContentProps) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KSelect.Portal>
      <KSelect.Content
        class={cn(
          'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95',
          local.class
        )}
        {...rest}
      >
        <KSelect.Listbox class="p-1" />
      </KSelect.Content>
    </KSelect.Portal>
  )
}

interface SelectItemProps extends ComponentProps<typeof KSelect.Item> {
  class?: string
  children?: JSX.Element
}
const SelectItem = (props: SelectItemProps) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <KSelect.Item
      class={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        local.class
      )}
      {...rest}
    >
      <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <KSelect.ItemIndicator>
          <Check class="h-4 w-4" />
        </KSelect.ItemIndicator>
      </span>
      <KSelect.ItemLabel>{local.children}</KSelect.ItemLabel>
    </KSelect.Item>
  )
}

interface SelectLabelProps extends ComponentProps<typeof KSelect.Label> {
  class?: string
}
const SelectLabel = (props: SelectLabelProps) => {
  const [local, rest] = splitProps(props, ['class'])
  return <KSelect.Label class={cn('py-1.5 pl-8 pr-2 text-sm font-semibold', local.class)} {...rest} />
}

export {
  Select,
  SelectContent,
  SelectHiddenSelect,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
}
