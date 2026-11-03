import { Tabs as KTabs } from '@kobalte/core/tabs'
import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const Tabs = KTabs

const TabsList = (props: ComponentProps<typeof KTabs.List> & { class?: string }) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KTabs.List
      class={cn(
        'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
        local.class
      )}
      {...rest}
    />
  )
}

const TabsTrigger = (props: ComponentProps<typeof KTabs.Trigger> & { class?: string }) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KTabs.Trigger
      class={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm',
        local.class
      )}
      {...rest}
    />
  )
}

const TabsContent = (props: ComponentProps<typeof KTabs.Content> & { class?: string }) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KTabs.Content
      class={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        local.class
      )}
      {...rest}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
