/**
 * Native scroll-area shim.
 *
 * The original baseline used Radix's `<ScrollArea>` which renders a custom
 * scrollbar. For the migration we fall back to a native overflow container —
 * cheaper bundle, identical UX for most cases. If consumers need branded
 * scrollbars they can swap to a Corvu/Kobalte primitive locally.
 */

import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

function ScrollArea(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('relative overflow-auto', local.class)} {...rest} />
}

function ScrollBar(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <div class={cn('hidden', local.class)} {...rest} />
}

export { ScrollArea, ScrollBar }
