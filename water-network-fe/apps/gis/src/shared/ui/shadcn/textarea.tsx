import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

export function Textarea(props: ComponentProps<'textarea'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <textarea
      class={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        local.class
      )}
      {...rest}
    />
  )
}
