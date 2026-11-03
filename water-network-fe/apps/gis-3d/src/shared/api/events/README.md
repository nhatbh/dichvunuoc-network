# Event System Architecture

## Structure

```
shared/lib/events/
├── core/event.base.ts   # BaseEvent abstract class (all events extend this)
├── event-key.ts         # Event name constants
├── registry.ts          # ApplicationEvents type map
├── bus.ts               # Event bus instance (mitt)
├── use-event-listener.ts # Solid hook for subscribing to events
└── index.ts             # Public API exports
```

## Adding New Domain Events

1. Add event key constants to `event-key.ts`
2. Add the event type mapping in `registry.ts`
3. Optionally create an event class extending `BaseEvent`

### Example

```ts
// event-key.ts
export const ORDER_PLACED = 'order:placed' as const

// registry.ts
export interface ApplicationEvents {
  [ORDER_PLACED]: BaseEvent & { orderId: string; amount: number }
}
```

## Usage

```ts
import { eventBus, ORDER_PLACED } from '@/shared/lib/events'

// Emit
eventBus.emit(ORDER_PLACED, { timestamp: Date.now(), orderId: '123', amount: 99.99 })

// Subscribe (in a Solid component)
import { useEventListener } from '@/shared/lib/events'

useEventListener(ORDER_PLACED, (event) => {
  console.log('Order placed:', event.orderId)
})
```
