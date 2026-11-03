/**
 * Toast Provider (Solid).
 */

import type { JSX } from 'solid-js'
import { Toaster } from 'solid-sonner'

export function ToastProvider(props: { children: JSX.Element }) {
  return (
    <>
      {props.children}
      <Toaster position="top-right" richColors />
    </>
  )
}
