/**
 * Clipboard helper for Solid.
 *
 * Returns reactive accessors `isCopied()` / `error()` plus an async `copy(text)`
 * function. Uses the same toast wrapper as before for user feedback.
 */

import { createSignal, type Accessor } from 'solid-js'
import { toast } from '@/shared/lib/toast'

interface UseClipboardOptions {
  timeout?: number
  successMessage?: string
  errorMessage?: string
  showToast?: boolean
}

export interface ClipboardApi {
  isCopied: Accessor<boolean>
  error: Accessor<Error | null>
  copy: (text: string) => Promise<void>
}

export function useClipboard(options: UseClipboardOptions = {}): ClipboardApi {
  return createClipboard(options)
}

export function createClipboard(options: UseClipboardOptions = {}): ClipboardApi {
  const {
    timeout = 2000,
    successMessage = 'Copied to clipboard',
    errorMessage = 'Failed to copy to clipboard',
    showToast = true,
  } = options

  const [isCopied, setIsCopied] = createSignal(false)
  const [error, setError] = createSignal<Error | null>(null)

  const copy = async (text: string) => {
    setError(null)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        try {
          document.execCommand('copy')
        } finally {
          document.body.removeChild(textArea)
        }
      }
      setIsCopied(true)
      if (showToast) toast.success('Copied', successMessage)
      setTimeout(() => setIsCopied(false), timeout)
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Unknown error')
      setError(e)
      setIsCopied(false)
      if (showToast) toast.error('Copy failed', errorMessage)
      throw e
    }
  }

  return { isCopied, error, copy }
}
