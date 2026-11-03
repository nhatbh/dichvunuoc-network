/**
 * useEventListener — Solid lifecycle-aware event bus subscription.
 *
 * Automatically cleans up the listener when the owning component unmounts.
 */

import { onCleanup, onMount } from 'solid-js'
import { eventBus } from './bus'
import type { BaseEvent } from './core/event.base'

export function useEventListener<T extends BaseEvent>(
  eventName: string,
  handler: (event: T) => void
): void {
  onMount(() => {
    const typedHandler = handler as (event: BaseEvent) => void
    eventBus.on(eventName, typedHandler)
    onCleanup(() => eventBus.off(eventName, typedHandler))
  })
}
