import { Show, splitProps, type ComponentProps } from 'solid-js'

export interface RadioProps extends Omit<ComponentProps<'input'>, 'class' | 'type'> {
  label?: string
  error?: string
  helperText?: string
  class?: string
}

export function Radio(props: RadioProps) {
  const [local, rest] = splitProps(props, ['label', 'error', 'helperText', 'class'])

  const base = 'h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 transition-colors'
  const errorCls = 'border-red-300 focus:ring-red-500'

  return (
    <div class="w-full">
      <div class="flex items-start">
        <input
          type="radio"
          class={`${base} ${local.error ? errorCls : ''} ${local.class ?? ''}`}
          aria-describedby={
            local.error || local.helperText
              ? `${rest.id}-${local.error ? 'error' : 'helper'}`
              : undefined
          }
          {...rest}
        />
        <Show when={local.label}>
          <label for={rest.id} class="ml-2 block text-sm text-gray-700">
            {local.label}
            <Show when={rest.required}>
              <span class="text-red-500 ml-1">*</span>
            </Show>
          </label>
        </Show>
      </div>
      <Show when={local.error}>
        <p id={`${rest.id}-error`} class="mt-1 text-sm text-red-600" role="alert">
          {local.error}
        </p>
      </Show>
      <Show when={!local.error && local.helperText}>
        <p id={`${rest.id}-helper`} class="mt-1 text-sm text-gray-500">
          {local.helperText}
        </p>
      </Show>
    </div>
  )
}
