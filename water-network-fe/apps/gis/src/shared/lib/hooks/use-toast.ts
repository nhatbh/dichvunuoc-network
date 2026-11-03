/**
 * Solid-friendly `useToast` wrapper around `solid-sonner`.
 *
 * The legacy React implementation was a reducer-driven toast queue. With
 * `solid-sonner` the `<Toaster />` component owns its own queue, so this hook
 * is now a thin convenience layer that mirrors `@/shared/lib/toast`.
 */

import { toast as sonnerToast } from 'solid-sonner'

export function useToast() {
  return {
    toast: sonnerToast,
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  }
}

export { sonnerToast as toast }
