/**
 * Base Event Abstract Class
 * 
 * All events must extend this base class to ensure consistency.
 * The timestamp field is required for all events to enable event ordering and debugging.
 * 
 * Each event class must define a static EVENT_NAME property that references
 * the event name from the event-names registry.
 */

import type { EventKey } from '../event-key'

export abstract class BaseEvent {
  /**
   * The event name - must be set by each subclass
   */
  abstract readonly eventName: EventKey

  /**
   * Timestamp when the event occurred
   */
  readonly timestamp: number

  constructor(timestamp?: number) {
    this.timestamp = timestamp ?? Date.now()
  }

  /**
   * Get the event name for this event instance
   */
  getEventName(): EventKey {
    return this.eventName
  }

  /**
   * Convert event to plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      eventName: this.eventName,
      timestamp: this.timestamp,
      ...this.getPayload(),
    }
  }

  /**
   * Get the event-specific payload (excluding eventName and timestamp)
   * Must be implemented by subclasses
   */
  protected abstract getPayload(): Record<string, unknown>
}

