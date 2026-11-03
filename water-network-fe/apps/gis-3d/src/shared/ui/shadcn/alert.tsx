import { cva, type VariantProps } from 'class-variance-authority'
import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

interface AlertProps
  extends Omit<ComponentProps<'div'>, 'class'>,
    VariantProps<typeof alertVariants> {
  class?: string
}

function Alert(props: AlertProps) {
  const [local, rest] = splitProps(props, ['class', 'variant'])
  return (
    <div
      role="alert"
      class={cn(alertVariants({ variant: local.variant }), local.class)}
      {...rest}
    />
  )
}

interface AlertTitleProps extends Omit<ComponentProps<'h5'>, 'class' | 'children'> {
  class?: string
  children?: JSX.Element
}

function AlertTitle(props: AlertTitleProps) {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <h5 class={cn('mb-1 font-medium leading-none tracking-tight', local.class)} {...rest}>
      {local.children}
    </h5>
  )
}

function AlertDescription(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('text-sm [&_p]:leading-relaxed', local.class)} {...rest} />
}

export { Alert, AlertTitle, AlertDescription }
