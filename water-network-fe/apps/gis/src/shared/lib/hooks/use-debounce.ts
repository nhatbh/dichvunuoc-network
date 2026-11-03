/**
 * Debounced value accessor for Solid.
 *
 * Mirrors the contract of the prior React `useDebounce(value, delay)` hook but
 * accepts a reactive accessor and returns an accessor — pass any signal/memo in,
 * read the debounced mirror out.
 */

import { debounce } from '@solid-primitives/scheduled'
import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'

export function useDebounce<T>(value: Accessor<T>, delay: number = 500): Accessor<T> {
  return createDebouncedAccessor(value, delay)
}

export function createDebouncedAccessor<T>(
  value: Accessor<T>,
  delay: number = 500
): Accessor<T> {
  const [snapshot, setSnapshot] = createSignal<T>(value())
  const trigger = debounce((v: T) => setSnapshot(() => v), delay)
  onCleanup(() => trigger.clear())

  createMemo(() => {
    const next = value()
    trigger(next)
  })

  return snapshot
}
