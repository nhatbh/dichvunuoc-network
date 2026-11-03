/**
 * Auth client facade.
 *
 * Keep this module as the only public auth entry point for routes, features,
 * API clients, and session hooks. Services can switch implementation by env
 * without changing call sites.
 */

import { env } from '@/shared/config/env'
import { backendSessionAuth } from './backend-session-auth'
import { keycloakAuth } from './keycloak-auth'
import { isMockAuthActive, mockAuth } from './mock-auth'
import type { TenantContextSource } from './tenant-context'

export interface AuthUser {
  id: string
  email?: string
  name?: string
  username?: string
  roles?: string[]
  permissions?: string[]
  /** Validated tenant projection used by GIS APIs and telemetry. */
  tenantId?: string
  /** Selected Keycloak Organization alias, when an Organization context exists. */
  organizationAlias?: string
  organizationId?: string
  tenantContextSource?: TenantContextSource
  [key: string]: unknown
}

export interface AuthSession {
  token?: string
  idToken?: string
  expiresAt?: number
  [key: string]: unknown
}

export interface AuthSessionData {
  user: AuthUser
  session: AuthSession
}

export interface EmailCredentials {
  email: string
  password: string
  name?: string
}

export interface AuthClient {
  signUp: {
    email: (params: EmailCredentials) => Promise<unknown>
  }
  signIn: {
    email: (params: Pick<EmailCredentials, 'email' | 'password'>) => Promise<unknown>
  }
  signOut: () => Promise<void>
  getSession: () => Promise<AuthSessionData | null>
  getAccessToken: () => Promise<string | null>
  login: (redirectUri?: string) => Promise<void>
  logout: (redirectUri?: string) => Promise<void>
  updateToken: (minValiditySeconds?: number) => Promise<boolean>
  hasRole: (role: string) => Promise<boolean>
  hasPermission: (permission: string) => Promise<boolean>
}

const mockAuthClient: AuthClient = {
  signUp: {
    email: mockAuth.signUp.email,
  },
  signIn: {
    email: mockAuth.signIn.email,
  },
  signOut: mockAuth.signOut,
  getSession: mockAuth.getSession,
  getAccessToken: async () => {
    const session = await mockAuth.getSession()
    return session?.session.token ?? null
  },
  login: async () => {},
  logout: mockAuth.signOut,
  updateToken: async () => true,
  hasRole: async role => {
    const session = await mockAuth.getSession()
    return session?.user.roles?.includes(role) ?? false
  },
  hasPermission: async permission => {
    const session = await mockAuth.getSession()
    return session?.user.permissions?.includes(permission) ?? false
  },
}

function resolveAuthClient(): AuthClient {
  if (env.VITE_AUTH_MODE === 'keycloak') {
    return keycloakAuth
  }

  if (env.VITE_AUTH_MODE === 'mock' || isMockAuthActive) {
    return mockAuthClient
  }

  return backendSessionAuth
}

export const authClient = resolveAuthClient()
