# Event Bus System Guide

## Overview

This project implements a type-safe, client-side Event Bus using `mitt` following strict Feature-Sliced Design (FSD) principles. The event system enables decoupled communication between different layers of the application.

## Architecture

### FSD Layer Rules

1. **Shared Layer** (Source of Truth)
   - Contains all event type definitions
   - Provides the global event bus instance
   - Accessible to all layers

2. **Entity Layer** (Producers)
   - Can only import from Shared layer
   - Emits events to the bus
   - Cannot import from other entities or features

3. **Feature Layer** (Consumers/Chainers)
   - Can import from Entities and Shared layers
   - Subscribes to events and processes them
   - Can emit new events back to the bus

4. **App Layer** (Orchestrator)
   - Mounts all feature-level listeners
   - Ensures event chains are active globally

## File Structure

```
src/
├── shared/
│   └── api/
│       └── events/
│           ├── registry.ts      # ApplicationEvents interface (all event types)
│           └── bus.ts           # Global eventBus instance
│
├── entities/
│   └── post/
│       ├── api/
│       │   └── like-post.ts     # Entity action that emits 'post:liked'
│       ├── ui/
│       │   └── like-button.tsx  # Example UI component
│       └── index.ts             # Public API
│
├── features/
│   └── process-rewards/
│       ├── api/
│       │   └── use-reward-chain.ts  # Feature hook that listens to events
│       └── index.ts                 # Public API
│
└── app/
    └── providers/
        └── event-registry.tsx   # Mounts all feature listeners
```

## Usage Examples

### 1. Emitting Events (Entity Layer)

```tsx
// src/entities/post/api/like-post.ts
import { eventBus } from '@/shared/api/events/bus'

export async function likePost(params: LikePostParams) {
  // ... your business logic ...

  // Emit event
  eventBus.emit('post:liked', {
    postId: params.postId,
    userId: params.userId,
    timestamp: Date.now(),
  })
}
```

### 2. Subscribing to Events (Feature Layer)

```tsx
// src/features/process-rewards/api/use-reward-chain.ts
import { useEventListener } from '@/shared/lib/events/use-event-listener'
import type { ApplicationEvents } from '@/shared/lib/events/registry'

export function useRewardChain() {
  const handlePostLiked = (payload: ApplicationEvents['post:liked']) => {
    // Process the event
    console.log('Post liked:', payload)
  }

  useEventListener('post:liked', handlePostLiked)
}
```

### 3. Adding New Event Types

1. **Define the event in the registry** (`src/shared/api/events/registry.ts`):

```ts
export interface ApplicationEvents {
  // ... existing events ...

  'new:event': {
    field1: string
    field2: number
    timestamp: number
  }
}
```

2. **Emit the event** (from Entity or Feature):

```ts
eventBus.emit('new:event', {
  field1: 'value',
  field2: 123,
  timestamp: Date.now(),
})
```

3. **Subscribe to the event** (in Feature):

```ts
eventBus.on('new:event', payload => {
  // Handle the event
})
```

### 4. Event Chain Example

The reward processing feature demonstrates an event chain:

1. **Entity emits**: `post:liked` event
2. **Feature listens**: `useRewardChain` hook subscribes to `post:liked`
3. **Feature processes**: Calls microservice via TanStack Query
4. **Feature emits**: `reward:processed` or `reward:failed` event
5. **Other features can listen**: To `reward:processed` for further processing

## Type Safety

All events are fully type-safe:

```ts
// ✅ TypeScript knows the payload structure
eventBus.emit('post:liked', {
  postId: '123',
  userId: '456',
  timestamp: Date.now(),
})

// ❌ TypeScript error - missing required fields
eventBus.emit('post:liked', {
  postId: '123',
  // Missing userId and timestamp
})

// ✅ TypeScript knows the payload type in handlers
eventBus.on('post:liked', payload => {
  // payload is typed as ApplicationEvents['post:liked']
  console.log(payload.postId) // ✅ Type-safe
  console.log(payload.userId) // ✅ Type-safe
})
```

## Best Practices

1. **Always define events in the registry first** - This is the single source of truth
2. **Entities only emit, never subscribe** - Keep entities simple and focused
3. **Features handle business logic** - Features subscribe to events and process them
4. **Mount feature hooks in EventRegistry** - Ensures listeners are active globally
5. **Clean up subscriptions** - Always return cleanup functions in useEffect
6. **Use descriptive event names** - Follow the pattern `entity:action` (e.g., `post:liked`)

## Current Event Types

See `src/shared/api/events/registry.ts` for all available event types:

- `post:liked` - Emitted when a post is liked
- `post:created` - Emitted when a post is created
- `post:deleted` - Emitted when a post is deleted
- `user:updated` - Emitted when user data is updated
- `user:logged-in` - Emitted when a user logs in
- `user:logged-out` - Emitted when a user logs out
- `reward:processed` - Emitted when a reward is successfully processed
- `reward:failed` - Emitted when reward processing fails
- `notification:created` - Emitted when a notification is created

## Adding New Features

To add a new feature that listens to events:

1. Create the feature in `src/features/your-feature/`
2. Create a hook that subscribes to events
3. Add the hook to `src/app/providers/event-registry.tsx`

Example:

```tsx
// src/app/providers/event-registry.tsx
export function EventRegistry() {
  useRewardChain() // Existing
  useYourNewFeature() // Add your new feature hook here

  return null
}
```

## Testing

To test the event bus:

```tsx
import { eventBus } from '@/shared/api/events/bus'

// Emit an event
eventBus.emit('post:liked', {
  postId: 'test-123',
  userId: 'user-456',
  timestamp: Date.now(),
})

// Subscribe to verify
eventBus.on('post:liked', payload => {
  console.log('Received:', payload)
})
```
