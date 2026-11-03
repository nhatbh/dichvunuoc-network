import { Tooltip as KTooltip } from '@kobalte/core/tooltip'
import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const TooltipProvider = (props: ComponentProps<typeof KTooltip>) => <KTooltip {...props} />
const Tooltip = KTooltip
const TooltipTrigger = KTooltip.Trigger

interface TooltipContentProps extends ComponentProps<typeof KTooltip.Content> {
  class?: string
}
const TooltipContent = (props: TooltipContentProps) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KTooltip.Portal>
      <KTooltip.Content
        class={cn(
          'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95',
          local.class
        )}
        {...rest}
      />
    </KTooltip.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
