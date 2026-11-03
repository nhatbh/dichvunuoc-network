import { Checkbox as KCheckbox } from '@kobalte/core/checkbox'
import { Check } from 'lucide-solid'
import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

interface CheckboxProps extends ComponentProps<typeof KCheckbox> {
  class?: string
}

const Checkbox = (props: CheckboxProps) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KCheckbox class={cn('inline-flex items-center', local.class)} {...rest}>
      <KCheckbox.Input class="sr-only" />
      <KCheckbox.Control class="peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary data-[checked]:text-primary-foreground">
        <KCheckbox.Indicator class="flex items-center justify-center text-current">
          <Check class="h-3 w-3" />
        </KCheckbox.Indicator>
      </KCheckbox.Control>
    </KCheckbox>
  )
}

export { Checkbox }
