import { Dialog as KDialog } from '@kobalte/core/dialog'
import { X } from 'lucide-solid'
import { splitProps, type ComponentProps, type JSX, type ParentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const Dialog = KDialog
const DialogTrigger = KDialog.Trigger
const DialogClose = KDialog.CloseButton
const DialogPortal = KDialog.Portal

interface OverlayProps extends ComponentProps<typeof KDialog.Overlay> {
  class?: string
}
const DialogOverlay = (props: OverlayProps) => {
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

interface DialogContentProps extends ParentProps<ComponentProps<typeof KDialog.Content>> {
  class?: string
}
const DialogContent = (props: DialogContentProps) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <DialogPortal>
      <DialogOverlay />
      <KDialog.Content
        class={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 sm:rounded-lg',
          local.class
        )}
        {...rest}
      >
        {local.children}
        <KDialog.CloseButton class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </KDialog.CloseButton>
      </KDialog.Content>
    </DialogPortal>
  )
}

const DialogHeader = (props: ComponentProps<'div'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      class={cn('flex flex-col space-y-1.5 text-center sm:text-left', local.class)}
      {...rest}
    />
  )
}

const DialogFooter = (props: ComponentProps<'div'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      class={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', local.class)}
      {...rest}
    />
  )
}

const DialogTitle = (props: ParentProps<{ class?: string; children?: JSX.Element }>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KDialog.Title
      class={cn('text-lg font-semibold leading-none tracking-tight', local.class)}
      {...rest}
    />
  )
}

const DialogDescription = (props: ParentProps<{ class?: string; children?: JSX.Element }>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KDialog.Description class={cn('text-sm text-muted-foreground', local.class)} {...rest} />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
