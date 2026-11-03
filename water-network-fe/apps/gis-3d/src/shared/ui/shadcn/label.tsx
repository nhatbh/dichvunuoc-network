/**
 * Plain Solid label. The legacy Radix `Label.Root` was just a `<label>` with
 * a tiny click-through helper; in Solid we render the element directly. For
 * Kobalte form primitives, the dedicated `<TextField.Label>` etc. should be
 * used instead.
 */

import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const labelClass =
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'

interface LabelProps extends Omit<ComponentProps<'label'>, 'class' | 'children'> {
  class?: string
  children?: JSX.Element
}

export function Label(props: LabelProps) {
  const [local, rest] = splitProps(props, ['class', 'children'])

  return (
    <label class={cn(labelClass, local.class)} {...rest}>
      {local.children}
    </label>
  )
}
