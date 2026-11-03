/**
 * Role-Based Access Control (RBAC) — mechanism only.
 *
 * This is the generic, app-agnostic RBAC primitive shipped with the template.
 * It intentionally defines NO concrete permissions and grants nothing by
 * default: authorization is expected to come from your IdP (Keycloak roles /
 * permission claims surfaced on the session). Configure the two registries
 * below (`rolePermissions`, `routeAccessControl`) for your app, and see
 * `permissions.example.ts` for a fully fleshed-out catalog you can copy.
 *
 * SECURITY: client-side RBAC is a UX affordance only (hide/disable UI, guard
 * navigation). It is trivially bypassable. ALWAYS enforce authorization on the
 * backend for every protected operation.
 *
 * Usage:
 * ```tsx
 * import { hasPermission, canAccessRoute } from '@/shared/lib/permissions'
 *
 * if (hasPermission('admin', 'settings:edit')) { ... }
 * if (canAccessRoute('/admin', 'admin')) { ... }
 * ```
 */

/**
 * Application Roles
 *
 * Generic role set applicable to most apps. Rename or extend per project, and
 * align the names with the realm/client roles your IdP issues.
 * Hierarchical: admin > moderator > user > guest.
 */
export const ROLES = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  USER: 'user',
  GUEST: 'guest',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

/**
 * Permission identifier.
 *
 * Free-form string, conventionally `<action>:<resource>` (e.g. `edit:post`).
 * Kept as `string` so each app can define its own catalog without editing the
 * template. For a typed catalog, see `permissions.example.ts`.
 */
export type Permission = string

/**
 * Role → permission mapping (static, client-side fallback).
 *
 * Empty by default: the template grants no permissions implicitly. Permission
 * checks fall back to the permission claims on the session token, which is the
 * recommended source of truth. Populate this only if you want static, role-based
 * grants in addition to (or instead of) token claims. See `permissions.example.ts`.
 */
const rolePermissions: Record<Role, Permission[]> = {
  admin: [],
  moderator: [],
  user: [],
  guest: [],
}

/**
 * Route access control mapping.
 *
 * List ONLY the routes this app actually serves. Used by `canAccessRoute` /
 * `routeAccessGuard` to gate navigation by role.
 */
interface RouteAccess {
  path: string
  roles: Role[]
  requireAuth?: boolean
}

const routeAccessControl: RouteAccess[] = [
  { path: '/', roles: Object.values(ROLES), requireAuth: false },
  { path: '/login', roles: Object.values(ROLES), requireAuth: false },
  { path: '/register', roles: Object.values(ROLES), requireAuth: false },
]

/**
 * Role hierarchy. Higher value = more privileged.
 */
export const roleHierarchy: Record<Role, number> = {
  guest: 0,
  user: 1,
  moderator: 2,
  admin: 3,
}

/**
 * Check if a role has a specific permission (via the static mapping above).
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false
}

/**
 * Check if a role has any of the specified permissions.
 */
export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(role, permission))
}

/**
 * Check if a role has all of the specified permissions.
 */
export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every(permission => hasPermission(role, permission))
}

/**
 * Get all statically-mapped permissions for a role.
 */
export function getRolePermissions(role: Role): Permission[] {
  return rolePermissions[role] ?? []
}

/**
 * Check if a role can access a specific route.
 *
 * Exact match first, then longest non-root prefix match (for nested routes).
 * Unknown routes default to authenticated roles (user and above).
 */
export function canAccessRoute(path: string, role: Role): boolean {
  let routeConfig = routeAccessControl.find(route => route.path === path)

  if (!routeConfig) {
    routeConfig = routeAccessControl.find(
      route => path.startsWith(route.path) && route.path !== '/'
    )
  }

  if (!routeConfig) {
    return role === ROLES.USER || role === ROLES.MODERATOR || role === ROLES.ADMIN
  }

  return routeConfig.roles.includes(role)
}

/**
 * Check if a route requires authentication.
 */
export function requiresAuth(path: string): boolean {
  const routeConfig = routeAccessControl.find(
    route => route.path === path || (path.startsWith(route.path) && route.path !== '/')
  )

  return routeConfig?.requireAuth ?? true
}

/**
 * Check if a role is higher than or equal to another role.
 */
export function hasRoleLevel(role: Role, requiredRole: Role): boolean {
  return roleHierarchy[role] >= roleHierarchy[requiredRole]
}

/**
 * Type guard for a known role.
 */
export function isValidRole(role: string): role is Role {
  return Object.values(ROLES).includes(role as Role)
}
