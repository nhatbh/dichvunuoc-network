/**
 * Route Guards
 *
 * Utilities for protecting routes with authentication and authorization checks.
 */

import { redirect } from '@tanstack/solid-router'
import { env } from '@/shared/config/env'
import { authClient } from './client-auth'
import { canAccessRoute, type Role } from './permissions'

export async function requireAuth(): Promise<boolean> {
  try {
    const session = await authClient.getSession()
    return session !== null
  } catch {
    return false
  }
}

function buildReturnUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}`
}

/**
 * Route guard for protected routes.
 * - Keycloak: starts OIDC login with return URL (SSO session may already exist).
 * - Mock / other: redirects to `/login` with `redirect` search param.
 */
export async function authGuard(): Promise<void> {
  const isAuthenticated = await requireAuth()
  if (isAuthenticated) return

  if (env.VITE_AUTH_MODE === 'keycloak') {
    const returnTo = buildReturnUrl() || undefined
    await authClient.login(returnTo)
    return
  }

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'
  throw redirect({ to: '/login', search: { redirect: currentPath } })
}

/**
 * Role-based route guard.
 * Checks that the user is authenticated AND has the required role.
 */
export async function roleGuard(requiredRole: Role): Promise<void> {
  await authGuard()

  const hasRole = await authClient.hasRole(requiredRole)
  if (hasRole) return

  throw redirect({ to: '/login', search: { redirect: window.location.pathname } })
}

/**
 * Permission-based route guard.
 * Checks that the user is authenticated AND has the required permission.
 */
export async function permissionGuard(permission: string): Promise<void> {
  await authGuard()

  const hasPermission = await authClient.hasPermission(permission)
  if (hasPermission) return

  throw redirect({ to: '/login', search: { redirect: window.location.pathname } })
}

/**
 * Route access guard that checks static route-role mapping.
 */
export async function routeAccessGuard(path: string): Promise<void> {
  await authGuard()

  const session = await authClient.getSession()
  if (!session?.user?.roles?.length) {
    throw redirect({ to: '/login', search: { redirect: window.location.pathname } })
  }

  const userRole = session.user.roles[0] as Role
  if (!canAccessRoute(path, userRole)) {
    throw redirect({ to: '/login', search: { redirect: window.location.pathname } })
  }
}
