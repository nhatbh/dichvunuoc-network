import { splitProps, type ComponentProps } from 'solid-js'

interface SpinnerProps extends Omit<ComponentProps<'div'>, 'class'> {
  size?: 'sm' | 'md' | 'lg'
  class?: string
}

export function Spinner(props: SpinnerProps) {
  const [local, rest] = splitProps(props, ['size', 'class'])
  const sizeStyles = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }
  return (
    <div
      role="status"
      class={`inline-block animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite] ${
        sizeStyles[local.size ?? 'md']
      } ${local.class ?? ''}`}
      {...rest}
    >
      <span class="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
        Loading...
      </span>
    </div>
  )
}
