import { RadioGroup as KRadioGroup } from '@kobalte/core/radio-group'
import { Circle } from 'lucide-solid'
import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cn } from '@/shared/lib/utils'

interface RadioGroupProps extends ComponentProps<typeof KRadioGroup> {
  class?: string
  children?: JSX.Element
}

const RadioGroup = (props: RadioGroupProps) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <KRadioGroup class={cn('grid gap-2', local.class)} {...rest}>
      {local.children}
    </KRadioGroup>
  )
}

interface RadioGroupItemProps extends ComponentProps<typeof KRadioGroup.Item> {
  class?: string
}

const RadioGroupItem = (props: RadioGroupItemProps) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KRadioGroup.Item class={cn('inline-flex items-center', local.class)} {...rest}>
      <KRadioGroup.ItemInput class="sr-only" />
      <KRadioGroup.ItemControl class="aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        <KRadioGroup.ItemIndicator class="flex items-center justify-center">
          <Circle class="h-2.5 w-2.5 fill-current text-current" />
        </KRadioGroup.ItemIndicator>
      </KRadioGroup.ItemControl>
    </KRadioGroup.Item>
  )
}

export { RadioGroup, RadioGroupItem }
