import { Image as KImage } from '@kobalte/core/image'
import { splitProps, type ComponentProps } from 'solid-js'
import { cn } from '@/shared/lib/utils'

const Avatar = (props: ComponentProps<typeof KImage> & { class?: string }) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KImage
      class={cn(
        'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full',
        local.class
      )}
      {...rest}
    />
  )
}

const AvatarImage = (props: ComponentProps<typeof KImage.Img> & { class?: string }) => {
  const [local, rest] = splitProps(props, ['class'])
  return <KImage.Img class={cn('aspect-square h-full w-full', local.class)} {...rest} />
}

const AvatarFallback = (props: ComponentProps<typeof KImage.Fallback> & { class?: string }) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <KImage.Fallback
      class={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-muted',
        local.class
      )}
      {...rest}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
