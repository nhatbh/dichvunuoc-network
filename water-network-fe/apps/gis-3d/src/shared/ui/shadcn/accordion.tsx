import { Accordion as KAccordion } from '@kobalte/core/accordion'
import { ChevronDown } from 'lucide-solid'
import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const Accordion = KAccordion

const AccordionItem = (props: ComponentProps<typeof KAccordion.Item> & { class?: string }) => {
  const [local, rest] = splitProps(props, ['class'])
  return <KAccordion.Item class={cn('border-b', local.class)} {...rest} />
}

const AccordionTrigger = (
  props: ComponentProps<typeof KAccordion.Trigger> & { class?: string; children?: JSX.Element }
) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <KAccordion.Header class="flex">
      <KAccordion.Trigger
        class={cn(
          'flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-expanded]>svg]:rotate-180',
          local.class
        )}
        {...rest}
      >
        {local.children}
        <ChevronDown class="h-4 w-4 shrink-0 transition-transform duration-200" />
      </KAccordion.Trigger>
    </KAccordion.Header>
  )
}

const AccordionContent = (
  props: ComponentProps<typeof KAccordion.Content> & { class?: string; children?: JSX.Element }
) => {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <KAccordion.Content
      class={cn(
        'overflow-hidden text-sm transition-all data-[expanded]:animate-accordion-down data-[closed]:animate-accordion-up',
        local.class
      )}
      {...rest}
    >
      <div class="pb-4 pt-0">{local.children}</div>
    </KAccordion.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
