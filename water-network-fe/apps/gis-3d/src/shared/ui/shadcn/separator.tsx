import { Separator as KSeparator, type SeparatorRootProps } from '@kobalte/core/separator'
import { splitProps, type ValidComponent } from 'solid-js'
import { cn } from '@/shared/lib/utils'

type SolidSeparatorProps<T extends ValidComponent = 'hr'> = SeparatorRootProps<T> & {
  class?: string
}

export function Separator<T extends ValidComponent = 'hr'>(props: SolidSeparatorProps<T>) {
  const [local, rest] = splitProps(props as SolidSeparatorProps, ['class', 'orientation'])
  return (
    <KSeparator
      orientation={local.orientation ?? 'horizontal'}
      class={cn(
        'shrink-0 bg-border',
        (local.orientation ?? 'horizontal') === 'horizontal'
          ? 'h-[1px] w-full'
          : 'h-full w-[1px]',
        local.class
      )}
      {...rest}
    />
  )
}
