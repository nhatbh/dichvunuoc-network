import { cva, type VariantProps } from 'class-variance-authority'
import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends Omit<ComponentProps<'div'>, 'class'>,
    VariantProps<typeof badgeVariants> {
  class?: string
}

export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ['class', 'variant'])
  return <div class={cn(badgeVariants({ variant: local.variant }), local.class)} {...rest} />
}

export { badgeVariants }
