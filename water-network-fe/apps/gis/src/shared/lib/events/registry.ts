/**
 * Application Events Registry
 *
 * Single source of truth for all event types in the application.
 * Add your domain event interfaces here.
 *
 * FSD Rule: Lower layers cannot depend on higher layers.
 * This registry is in the Shared layer, making it accessible to all layers.
 */

import { BaseEvent } from './core/event.base'
import { USER_LOGGED_IN, USER_LOGGED_OUT } from './event-key'

/**
 * Application Events
 *
 * Maps event names to their payload types.
 * Add new domain events here as your app grows.
 */
export interface ApplicationEvents {
  [USER_LOGGED_IN]: BaseEvent & { userId: string; email: string }
  [USER_LOGGED_OUT]: BaseEvent & { userId: string }
}

/**
 * Application Events with index signature for mitt compatibility
 */
export type ApplicationEventsWithIndex = ApplicationEvents & Record<string | symbol, BaseEvent>
