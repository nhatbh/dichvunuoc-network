/**
 * Backend-Session Auth Adapter
 *
 * Uses cookie-based sessions managed by a BFF (Backend-For-Frontend)
 * or API gateway. Includes CSRF token handling for state-changing requests.
 *
 * The session cookie is httpOnly so JS cannot read it directly.
 * The CSRF token is fetched from a dedicated endpoint on page load.
 */

import { httpClient } from '@/shared/api/http-client'
import type { AuthClient, AuthSessionData } from './client-auth'

let csrfToken: string | null = null

async function fetchCsrfToken(): Promise<string> {
  const res = await httpClient.get<{ csrfToken: string }>('/auth/csrf', { skipAuth: true })
  csrfToken = res.csrfToken
  return csrfToken
}

async function getCsrfHeaders(): Promise<Record<string, string>> {
  if (!csrfToken) {
    await fetchCsrfToken()
  }
  return { 'X-CSRF-Token': csrfToken ?? '' }
}

const backendSessionAuth: AuthClient = {
  signUp: {
    email: async params => {
      const headers = await getCsrfHeaders()
      const result = await httpClient.post<AuthSessionData>('/auth/register', params, {
        headers,
        skipAuth: true,
      })
      return result
    },
  },
  signIn: {
    email: async params => {
      const headers = await getCsrfHeaders()
      const result = await httpClient.post<AuthSessionData>('/auth/login', params, {
        headers,
        skipAuth: true,
      })
      return result
    },
  },
  signOut: async () => {
    const headers = await getCsrfHeaders()
    await httpClient.post('/auth/logout', undefined, { headers })
    csrfToken = null
  },
  getSession: async () => {
    try {
      return await httpClient.get<AuthSessionData>('/auth/session')
    } catch {
      return null
    }
  },
  getAccessToken: async () => {
    // Cookie-based sessions don't use Bearer tokens
    // Return a marker to indicate the session is cookie-authenticated
    try {
      const session = await httpClient.get<AuthSessionData>('/auth/session')
      return session?.session?.token ?? 'session-cookie'
    } catch {
      return null
    }
  },
  login: async redirectUri => {
    const redirect = redirectUri ?? window.location.href
    window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`
  },
  logout: async redirectUri => {
    const headers = await getCsrfHeaders()
    await httpClient.post('/auth/logout', undefined, { headers })
    csrfToken = null
    window.location.href = redirectUri ?? window.location.origin
  },
  updateToken: async () => {
    // Cookie-based sessions are refreshed server-side
    return true
  },
  hasRole: async role => {
    try {
      const session = await httpClient.get<AuthSessionData>('/auth/session')
      return session?.user?.roles?.includes(role) ?? false
    } catch {
      return false
    }
  },
  hasPermission: async permission => {
    try {
      const session = await httpClient.get<AuthSessionData>('/auth/session')
      return session?.user?.permissions?.includes(permission) ?? false
    } catch {
      return false
    }
  },
}

export { backendSessionAuth, fetchCsrfToken }
