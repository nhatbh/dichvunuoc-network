/**
 * Sheet primitive backed by Kobalte Dialog with side-aware animations.
 */

import { Dialog as KDialog } from '@kobalte/core/dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-solid'
import { splitProps, type ComponentProps, type JSX, type ParentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const Sheet = KDialog
const SheetTrigger = KDialog.Trigger
const SheetClose = KDialog.CloseButton
const SheetPortal = KDialog.Portal

const SheetOverlay = (props: ComponentProps<typeof KDialog.Overlay>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KDialog.Overlay
      class={cn(
        'fixed inset-0 z-50 bg-black/80 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0',
        local.class
      )}
      {...rest}
    />
  )
}

const sheetVariants = cva(
  'fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[expanded]:duration-500 data-[closed]:duration-300 data-[expanded]:animate-in data-[closed]:animate-out',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b data-[closed]:slide-out-to-top data-[expanded]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 border-t data-[closed]:slide-out-to-bottom data-[expanded]:slide-in-from-bottom',
        left: 'inset-y-0 left-0 h-full w-3/4 border-r data-[closed]:slide-out-to-left data-[expanded]:slide-in-from-left sm:max-w-sm',
        right:
          'inset-y-0 right-0 h-full w-3/4 border-l data-[closed]:slide-out-to-right data-[expanded]:slide-in-from-right sm:max-w-sm',
      },
    },
    defaultVariants: { side: 'right' },
  }
)

type SheetContentProps = ParentProps<ComponentProps<typeof KDialog.Content>> &
  VariantProps<typeof sheetVariants> & { class?: string }

const SheetContent = (props: SheetContentProps) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'side'])
  return (
    <SheetPortal>
      <SheetOverlay />
      <KDialog.Content class={cn(sheetVariants({ side: local.side }), local.class)} {...rest}>
        {local.children}
        <KDialog.CloseButton class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </KDialog.CloseButton>
      </KDialog.Content>
    </SheetPortal>
  )
}

const SheetHeader = (props: ComponentProps<'div'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      class={cn('flex flex-col space-y-2 text-center sm:text-left', local.class)}
      {...rest}
    />
  )
}

const SheetFooter = (props: ComponentProps<'div'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      class={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', local.class)}
      {...rest}
    />
  )
}

const SheetTitle = (props: ParentProps<{ class?: string; children?: JSX.Element }>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KDialog.Title class={cn('text-lg font-semibold text-foreground', local.class)} {...rest} />
  )
}

const SheetDescription = (props: ParentProps<{ class?: string; children?: JSX.Element }>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KDialog.Description class={cn('text-sm text-muted-foreground', local.class)} {...rest} />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
