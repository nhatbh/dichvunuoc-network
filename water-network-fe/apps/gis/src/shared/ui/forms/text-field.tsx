/**
 * Text input field for `@modular-forms/solid`.
 *
 * Accepts the props returned by `Field` (name, value, onInput, onChange,
 * onBlur, ref) plus optional `label` / `error` / `helperText` for UI chrome.
 */

import { splitProps, type ComponentProps, type JSX } from 'solid-js'
import { Show } from 'solid-js'

export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'class'> {
  label?: string
  error?: string
  helperText?: string
  class?: string
}

export function TextField(props: TextFieldProps) {
  const [local, rest] = splitProps(props, ['label', 'error', 'helperText', 'class'])

  const base =
    'block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 sm:text-sm transition-colors'
  const normal = 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
  const errorCls = 'border-red-300 focus:ring-red-500 focus:border-red-500'

  return (
    <div class="w-full">
      <Show when={local.label}>
        {label => (
          <label for={rest.id} class="block text-sm font-medium text-gray-700 mb-1">
            {label() as unknown as JSX.Element}
            <Show when={rest.required}>
              <span class="text-red-500 ml-1">*</span>
            </Show>
          </label>
        )}
      </Show>
      <input
        class={`${base} ${local.error ? errorCls : normal} ${local.class ?? ''}`}
        aria-invalid={local.error ? 'true' : 'false'}
        aria-describedby={
          local.error || local.helperText
            ? `${rest.id}-${local.error ? 'error' : 'helper'}`
            : undefined
        }
        {...rest}
      />
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
