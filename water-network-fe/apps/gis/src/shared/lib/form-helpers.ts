/**
 * Framework-agnostic form helpers.
 *
 * The original baseline depended on `react-hook-form` types; we've replaced
 * those with a generic `FormErrorMap` so the same helpers can be reused
 * from `@modular-forms/solid` (which gives you `string | undefined` per field).
 */

import { toast } from '@/shared/lib/toast'

export type FormErrorMap = Record<string, { message?: string } | string | undefined>

export function displayFormErrors(
  errors: FormErrorMap,
  options: {
    title?: string
    showIndividualToasts?: boolean
    maxErrors?: number
  } = {}
): void {
  const { title = 'Form validation failed', showIndividualToasts = false, maxErrors = 5 } = options
  const errorEntries = Object.entries(errors).slice(0, maxErrors)
  if (errorEntries.length === 0) return

  const messageOf = (e: FormErrorMap[string]): string | undefined => {
    if (typeof e === 'string') return e
    if (e && typeof e === 'object') return e.message
    return undefined
  }

  if (showIndividualToasts) {
    errorEntries.forEach(([field, error]) => {
      const msg = messageOf(error)
      if (msg) toast.error(formatFieldName(field), msg)
    })
    return
  }

  const messages = errorEntries
    .map(([field, error]) => {
      const msg = messageOf(error)
      return msg ? `• ${formatFieldName(field)}: ${msg}` : null
    })
    .filter(Boolean)
    .join('\n')

  if (messages) toast.error(title, messages)
}

export function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

export function apiErrorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message
    if ('error' in error && typeof error.error === 'string') return error.error
    if ('detail' in error && typeof error.detail === 'string') return error.detail
  }
  return 'An unexpected error occurred'
}

export function apiErrorsToFormErrors(
  apiErrors: Record<string, string | string[]> | undefined
): Record<string, string> {
  if (!apiErrors) return {}
  const formErrors: Record<string, string> = {}
  Object.entries(apiErrors).forEach(([field, error]) => {
    if (Array.isArray(error)) formErrors[field] = error[0] ?? 'Invalid value'
    else if (typeof error === 'string') formErrors[field] = error
  })
  return formErrors
}

export function hasFieldError(errors: FormErrorMap, fieldName: string): boolean {
  return fieldName in errors
}

export function getFieldError(errors: FormErrorMap, fieldName: string): string | undefined {
  const entry = errors[fieldName]
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') return entry.message
  return undefined
}

export function serializeToFormData(data: Record<string, unknown>): FormData {
  const formData = new FormData()
  Object.entries(data).forEach(([key, value]) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      value.forEach(item => formData.append(key, item as string | Blob))
    } else if (value instanceof File || value instanceof Blob) {
      formData.append(key, value)
    } else if (typeof value === 'object') {
      formData.append(key, JSON.stringify(value))
    } else {
      formData.append(key, String(value))
    }
  })
  return formData
}

export function cleanFormData<T extends Record<string, unknown>>(data: T): Partial<T> {
  const cleaned: Partial<T> = {}
  Object.entries(data).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      cleaned[key as keyof T] = value as T[keyof T]
    }
  })
  return cleaned
}
