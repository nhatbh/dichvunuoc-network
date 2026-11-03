/**
 * Event Bus
 * 
 * Centralized event bus using mitt for type-safe event communication.
 * This is the single instance used throughout the application.
 * 
 * FSD Rule: This is in the Shared layer, accessible to all layers.
 */

import mitt, { type Emitter } from 'mitt'
import type { ApplicationEventsWithIndex } from './registry'

/**
 * Global event bus instance
 * 
 * Usage:
 * - Emit events: const event = new PostLikedEvent({ postId, userId }); eventBus.emit(event.eventName, event)
 * - Subscribe: eventBus.on(POST_LIKED, (event: PostLikedEvent) => { ... })
 * - Unsubscribe: eventBus.off(POST_LIKED, handler)
 */
export const eventBus: Emitter<ApplicationEventsWithIndex> =
  mitt<ApplicationEventsWithIndex>()

