/**
 * Session Provider — Solid edition.
 *
 * Single source of truth for auth state. Uses `createStore` for the session
 * shape (so reads of `.user` vs `.isLoading` track independently), `onMount`
 * for the initial fetch and storage listener, and `createEffect` for Keycloak
 * SSO sync.
 *
 * Public hook `useSessionContext()` returns reactive **accessors** so existing
 * consumers can call them in JSX without forcing the whole component to
 * re-evaluate.
 */

import { useQueryClient } from '@tanstack/solid-query'
import {
  createContext,
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js'
import { createStore } from 'solid-js/store'
import { queryKeys } from '@/shared/api/query-keys'
import { env } from '@/shared/config/env'
import { broadcastAuthEvent, onAuthBroadcast } from '@/shared/lib/auth-broadcast'
import type { AuthSessionData } from '@/shared/lib/client-auth'
import { authClient } from '@/shared/lib/client-auth'
import { attachKeycloakSessionSync } from '@/shared/lib/keycloak-auth'
import { clearUser, setUser } from '@/shared/lib/monitoring'
import { createIdleTimeout } from '@/shared/lib/session-timeout'

interface SessionStoreShape {
  session: AuthSessionData | null
  isLoading: boolean
  error: Error | null
}

export interface SessionContextValue {
  session: Accessor<AuthSessionData | null>
  isLoading: Accessor<boolean>
  error: Accessor<Error | null>
  login: (email: string, password: string) => Promise<void>
  loginSso: (redirectUri?: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider(props: { children: JSX.Element }) {
  const queryClient = useQueryClient()
  const [state, setState] = createStore<SessionStoreShape>({
    session: null,
    isLoading: true,
    error: null,
  })

  const session = createMemo(() => state.session)
  const isLoading = createMemo(() => state.isLoading)
  const error = createMemo(() => state.error)

  const applySession = (data: AuthSessionData | null) => {
    setState('session', data)
    if (data?.user) {
      void setUser({ id: data.user.id, email: data.user.email, username: data.user.username })
    } else {
      void clearUser()
    }
  }

  const refreshSession = async () => {
    try {
      const data = await authClient.getSession()
      setState('error', null)
      applySession(data)
    } catch (err) {
      setState('error', err instanceof Error ? err : new Error('Failed to refresh session'))
    }
  }

  onMount(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await authClient.getSession()
        if (cancelled) return
        applySession(data)

        // Start idle timeout when user is authenticated
        if (data?.user) {
          createIdleTimeout(() => void logout())
        }
      } catch (err) {
        if (cancelled) return
        setState('error', err instanceof Error ? err : new Error('Failed to load session'))
      } finally {
        if (!cancelled) setState('isLoading', false)
      }
    }

    void load()

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'mock_session' || e.key === null) {
        void refreshSession()
      }
    }
    window.addEventListener('storage', onStorage)

    onCleanup(() => {
      cancelled = true
      window.removeEventListener('storage', onStorage)
      unsubBroadcast()
    })

    // Cross-tab session sync via BroadcastChannel
    const unsubBroadcast = onAuthBroadcast(type => {
      if (type === 'session_invalidated') {
        setState({ session: null, error: null })
        queryClient.clear()
        void clearUser()
      } else if (type === 'session_refreshed') {
        void refreshSession()
      }
    })
  })

  createEffect(() => {
    if (env.VITE_AUTH_MODE !== 'keycloak') return
    const invalidate = () => {
      void refreshSession()
      void queryClient.invalidateQueries({ queryKey: queryKeys.session() })
    }
    attachKeycloakSessionSync(invalidate)
  })

  const login = async (email: string, password: string) => {
    setState({ isLoading: true, error: null })
    try {
      await authClient.signIn.email({ email, password })
      const data = await authClient.getSession()
      applySession(data)
    } catch (err) {
      setState('error', err instanceof Error ? err : new Error('Login failed'))
      throw err
    } finally {
      setState('isLoading', false)
    }
  }

  const loginSso = async (redirectUri?: string) => {
    await authClient.login(redirectUri)
  }

  const logout = async () => {
    try {
      await authClient.signOut()
    } catch {
      /* signOut may fail if session already expired; continue cleanup */
    }
    setState({ session: null, error: null })
    queryClient.clear()
    void clearUser()
    broadcastAuthEvent('session_invalidated')
  }

  const value: SessionContextValue = {
    session,
    isLoading,
    error,
    login,
    loginSso,
    logout,
    refreshSession,
  }

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSessionContext must be used within a SessionProvider')
  }
  return ctx
}
