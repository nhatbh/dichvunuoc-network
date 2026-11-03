/**
 * Event Names Registry
 *
 * Central registry of all event name constants.
 * Add your domain event keys here as your application grows.
 *
 * Example:
 *   export const USER_LOGGED_IN = 'user:logged-in' as const
 *   export const USER_LOGGED_OUT = 'user:logged-out' as const
 */

// Auth events (template defaults)
export const USER_LOGGED_IN = 'user:logged-in' as const
export const USER_LOGGED_OUT = 'user:logged-out' as const

/**
 * All event names as a union type.
 * Extend this as you add more domain events.
 */
export type EventKey = typeof USER_LOGGED_IN | typeof USER_LOGGED_OUT
