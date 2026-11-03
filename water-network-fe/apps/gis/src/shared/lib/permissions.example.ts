/**
 * RBAC catalog — EXAMPLE / reference only.
 *
 * This file is intentionally NOT imported anywhere. It shows how to define a
 * concrete, typed permission catalog and role/route maps on top of the generic
 * mechanism in `permissions.ts`. To adopt it for your app:
 *
 *   1. Copy the pieces you need into `permissions.ts` (or a new app-level module).
 *   2. Replace the placeholder domains (post/comment/payment) with yours.
 *   3. Optionally narrow `Permission` to `AppPermission` for compile-time safety.
 *
 * It is type-checked (so it stays valid) but ships zero runtime cost since
 * nothing imports it. Delete it once you've wired up your own catalog.
 */

import { ROLES, type Role } from './permissions'

/**
 * Concrete permission catalog. Format: `<action>:<resource>`.
 */
export const PERMISSIONS = {
  // Posts
  CREATE_POST: 'create:post',
  EDIT_POST: 'edit:post',
  DELETE_POST: 'delete:post',
  VIEW_POST: 'view:post',

  // Comments
  CREATE_COMMENT: 'create:comment',
  MODERATE_COMMENT: 'moderate:comment',

  // Users
  VIEW_USERS: 'view:users',
  BAN_USER: 'ban:user',

  // Dashboard / data
  VIEW_DASHBOARD: 'view:dashboard',
  VIEW_ANALYTICS: 'view:analytics',
  EXPORT_DATA: 'export:data',

  // Payments
  PROCESS_PAYMENT: 'process:payment',
  REFUND_PAYMENT: 'refund:payment',

  // Settings
  VIEW_SETTINGS: 'view:settings',
  EDIT_SETTINGS: 'edit:settings',
  MANAGE_ROLES: 'manage:roles',
} as const

/** Narrowed permission type for compile-time safety against the catalog above. */
export type AppPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/**
 * Static role → permission grants. Roles typically inherit lower-role grants;
 * here `admin` gets everything.
 */
export const exampleRolePermissions: Record<Role, AppPermission[]> = {
  admin: Object.values(PERMISSIONS),

  moderator: [
    PERMISSIONS.CREATE_POST,
    PERMISSIONS.EDIT_POST,
    PERMISSIONS.DELETE_POST,
    PERMISSIONS.VIEW_POST,
    PERMISSIONS.CREATE_COMMENT,
    PERMISSIONS.MODERATE_COMMENT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.BAN_USER,
  ],

  user: [
    PERMISSIONS.CREATE_POST,
    PERMISSIONS.EDIT_POST,
    PERMISSIONS.VIEW_POST,
    PERMISSIONS.CREATE_COMMENT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.PROCESS_PAYMENT,
    PERMISSIONS.VIEW_SETTINGS,
  ],

  guest: [PERMISSIONS.VIEW_POST],
}

/**
 * Example route → roles map (mirrors the `routeAccessControl` shape in
 * `permissions.ts`). Demonstrates nested admin/moderator areas.
 */
export const exampleRouteAccessControl = [
  { path: '/', roles: Object.values(ROLES), requireAuth: false },
  { path: '/login', roles: Object.values(ROLES), requireAuth: false },
  { path: '/register', roles: Object.values(ROLES), requireAuth: false },
  { path: '/profile', roles: [ROLES.USER, ROLES.MODERATOR, ROLES.ADMIN], requireAuth: true },
  { path: '/moderate', roles: [ROLES.MODERATOR, ROLES.ADMIN], requireAuth: true },
  { path: '/admin', roles: [ROLES.ADMIN], requireAuth: true },
  { path: '/admin/users', roles: [ROLES.ADMIN], requireAuth: true },
] as const
