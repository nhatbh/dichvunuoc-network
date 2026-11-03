/**
 * Cross-Tab Session Broadcast
 *
 * Uses BroadcastChannel API to synchronize auth state changes
 * (login, logout, session expiry) across browser tabs.
 *
 * Falls back gracefully when BroadcastChannel is not available.
 */

type AuthBroadcastType = 'session_invalidated' | 'session_refreshed'

interface AuthBroadcastMessage {
  type: AuthBroadcastType
  timestamp: number
}

const CHANNEL_NAME = 'auth-session-sync'

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (!('BroadcastChannel' in window)) return null

  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return channel
}

export function broadcastAuthEvent(type: AuthBroadcastType): void {
  const ch = getChannel()
  if (!ch) return

  ch.postMessage({ type, timestamp: Date.now() } satisfies AuthBroadcastMessage)
}

export function onAuthBroadcast(
  handler: (type: AuthBroadcastType) => void,
): () => void {
  const ch = getChannel()
  if (!ch) return () => {}

  const listener = (event: MessageEvent<AuthBroadcastMessage>) => {
    handler(event.data.type)
  }

  ch.addEventListener('message', listener)
  return () => ch.removeEventListener('message', listener)
}
