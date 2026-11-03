import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-solid'
import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cn } from '@/shared/lib/utils'
import { buttonVariants, type ButtonProps } from '@/shared/ui/shadcn/button'

function Pagination(props: ComponentProps<'nav'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      class={cn('mx-auto flex w-full justify-center', local.class)}
      {...rest}
    />
  )
}

function PaginationContent(props: ComponentProps<'ul'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <ul class={cn('flex flex-row items-center gap-1', local.class)} {...rest} />
}

function PaginationItem(props: ComponentProps<'li'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <li class={cn('', local.class)} {...rest} />
}

interface PaginationLinkProps extends Omit<ComponentProps<'a'>, 'class'> {
  isActive?: boolean
  size?: ButtonProps['size']
  class?: string
  children?: JSX.Element
}

function PaginationLink(props: PaginationLinkProps) {
  const [local, rest] = splitProps(props, ['class', 'isActive', 'size', 'children'])
  return (
    <a
      aria-current={local.isActive ? 'page' : undefined}
      class={cn(
        buttonVariants({
          variant: local.isActive ? 'outline' : 'ghost',
          size: local.size ?? 'icon',
        }),
        local.class
      )}
      {...rest}
    >
      {local.children}
    </a>
  )
}

function PaginationPrevious(props: PaginationLinkProps) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      class={cn('gap-1 pl-2.5', local.class)}
      {...rest}
    >
      <ChevronLeft class="h-4 w-4" />
      <span>Previous</span>
    </PaginationLink>
  )
}

function PaginationNext(props: PaginationLinkProps) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      class={cn('gap-1 pr-2.5', local.class)}
      {...rest}
    >
      <span>Next</span>
      <ChevronRight class="h-4 w-4" />
    </PaginationLink>
  )
}

function PaginationEllipsis(props: ComponentProps<'span'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <span aria-hidden class={cn('flex h-9 w-9 items-center justify-center', local.class)} {...rest}>
      <MoreHorizontal class="h-4 w-4" />
      <span class="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
