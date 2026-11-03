/**
 * Idle Session Timeout
 *
 * Tracks user activity and triggers a callback after a configurable
 * period of inactivity. Designed to be used inside a Solid component
 * lifecycle (uses onCleanup).
 */

import { onCleanup } from 'solid-js'

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

export interface IdleTimeoutOptions {
  timeoutMs?: number
  /** Activities to listen to; defaults to common user interactions. */
  events?: readonly string[]
}

export function createIdleTimeout(onTimeout: () => void, options: IdleTimeoutOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const events = options.events ?? ACTIVITY_EVENTS

  let timer: ReturnType<typeof setTimeout> | undefined

  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(onTimeout, timeoutMs)
  }

  for (const event of events) {
    window.addEventListener(event, reset, { passive: true })
  }

  reset()

  onCleanup(() => {
    clearTimeout(timer)
    for (const event of events) {
      window.removeEventListener(event, reset)
    }
  })
}
