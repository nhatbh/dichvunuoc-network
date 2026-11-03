import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

function Card(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      class={cn('rounded-lg border bg-card text-card-foreground shadow-sm', local.class)}
      {...rest}
    />
  )
}

function CardHeader(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('flex flex-col space-y-1.5 p-6', local.class)} {...rest} />
}

function CardTitle(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div class={cn('text-2xl font-semibold leading-none tracking-tight', local.class)} {...rest} />
  )
}

function CardDescription(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('text-sm text-muted-foreground', local.class)} {...rest} />
}

function CardContent(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('p-6 pt-0', local.class)} {...rest} />
}

function CardFooter(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('flex items-center p-6 pt-0', local.class)} {...rest} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
