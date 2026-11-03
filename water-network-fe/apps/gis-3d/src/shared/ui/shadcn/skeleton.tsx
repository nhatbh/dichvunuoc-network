import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

export function Skeleton(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('animate-pulse rounded-md bg-muted', local.class)} {...rest} />
}
