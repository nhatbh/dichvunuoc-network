/**
 * Derives the template `Role` from session data for UI RBAC.
 *
 * Priority:
 * 1. Explicit `user.role` when present and valid (custom claims / adapters).
 * 2. Highest known role from `user.roles` (realm + client roles from Keycloak).
 * 3. Otherwise `guest` (mock dev sessions should set `roles: ['user']` — see mock-auth).
 *
 * Align realm/client role names in Keycloak with `ROLES` in permissions.ts, or map via a future adapter.
 */

import { isValidRole, ROLES, type Role, roleHierarchy } from './permissions'
import type { AuthSessionData } from './client-auth'

function highestKnownRoleFromList(roleNames: string[]): Role | null {
  let best: Role | null = null
  let bestRank = -1
  const known = new Set(Object.values(ROLES))

  for (const raw of roleNames) {
    const normalized = raw.toLowerCase()
    for (const candidate of known) {
      if (candidate.toLowerCase() === normalized) {
        const rank = roleHierarchy[candidate]
        if (rank > bestRank) {
          bestRank = rank
          best = candidate
        }
      }
    }
  }

  return best
}

export function deriveAppRoleFromSession(session: AuthSessionData | null | undefined): Role {
  if (!session?.user) {
    return ROLES.GUEST
  }

  const user = session.user

  if ('role' in user && typeof user.role === 'string' && isValidRole(user.role)) {
    return user.role
  }

  const fromTokenRoles = highestKnownRoleFromList(user.roles ?? [])
  if (fromTokenRoles) {
    return fromTokenRoles
  }

  return ROLES.GUEST
}
