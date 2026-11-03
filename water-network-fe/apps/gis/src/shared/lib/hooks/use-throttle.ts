/**
 * Throttled callback for Solid.
 *
 * Wraps a callback so it fires at most once per `delay` (trailing edge).
 * Replaces the React `useThrottle` which relied on `useRef` to keep state
 * across re-renders; in Solid the component body runs once so we just keep
 * timestamps in a closure.
 */

import { throttle } from '@solid-primitives/scheduled'
import { onCleanup } from 'solid-js'

export function useThrottle<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delay: number = 500
): (...args: TArgs) => void {
  return createThrottledCallback(callback, delay)
}

export function createThrottledCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delay: number = 500
): (...args: TArgs) => void {
  const trigger = throttle((...args: TArgs) => callback(...args), delay)
  onCleanup(() => trigger.clear())
  return (...args: TArgs) => trigger(...args)
}
