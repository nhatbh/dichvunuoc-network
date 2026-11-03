import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

function Table(props: ComponentProps<'table'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div class="relative w-full overflow-auto">
      <table class={cn('w-full caption-bottom text-sm', local.class)} {...rest} />
    </div>
  )
}

function TableHeader(props: ComponentProps<'thead'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <thead class={cn('[&_tr]:border-b', local.class)} {...rest} />
}

function TableBody(props: ComponentProps<'tbody'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <tbody class={cn('[&_tr:last-child]:border-0', local.class)} {...rest} />
}

function TableFooter(props: ComponentProps<'tfoot'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <tfoot
      class={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', local.class)}
      {...rest}
    />
  )
}

function TableRow(props: ComponentProps<'tr'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <tr
      class={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        local.class
      )}
      {...rest}
    />
  )
}

function TableHead(props: ComponentProps<'th'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <th
      class={cn(
        'h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
        local.class
      )}
      {...rest}
    />
  )
}

function TableCell(props: ComponentProps<'td'>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <td class={cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', local.class)} {...rest} />
  )
}

function TableCaption(props: ComponentProps<'caption'>) {
  const [local, rest] = splitProps(props, ['class'])
  return <caption class={cn('mt-4 text-sm text-muted-foreground', local.class)} {...rest} />
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
