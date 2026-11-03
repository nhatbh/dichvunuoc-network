/**
 * Auth Token Utility with caching
 *
 * Caches access tokens in memory and proactively refreshes
 * before expiry to reduce redundant Keycloak calls.
 */

import { authClient } from './client-auth'

const REFRESH_BUFFER_MS = 30_000 // refresh 30s before expiry

let cachedToken: { value: string; expiresAt: number } | null = null

export function clearTokenCache(): void {
  cachedToken = null
}

export async function getAuthToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - REFRESH_BUFFER_MS) {
    return cachedToken.value
  }

  try {
    const token = await authClient.getAccessToken()
    if (token) {
      // Attempt to extract expiry from session; fall back to 5-minute cache
      const session = await authClient.getSession()
      const expiresAt = session?.session.expiresAt ?? Date.now() + 5 * 60 * 1000
      cachedToken = { value: token, expiresAt }
    } else {
      cachedToken = null
    }
    return token
  } catch {
    cachedToken = null
    return null
  }
}
