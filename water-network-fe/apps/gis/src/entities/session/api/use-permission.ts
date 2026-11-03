/**
 * Permission accessors for Solid (session entity).
 */

import { createMemo, type Accessor } from 'solid-js'
import { deriveAppRoleFromSession } from '@/shared/lib/auth-role'
import {
  canAccessRoute,
  hasAnyPermission,
  hasPermission,
  hasRoleLevel,
  type Permission,
  type Role,
} from '@/shared/lib/permissions'
import { useSession } from './use-session'

function useTokenPermissionSet(): Accessor<Set<string>> {
  const session = useSession()
  return createMemo(() => {
    const list = session.data()?.user?.permissions
    if (!list?.length) return new Set<string>()
    return new Set(list)
  })
}

function useUserRole(): Accessor<Role> {
  const session = useSession()
  return createMemo(() => deriveAppRoleFromSession(session.data() ?? null))
}

export function usePermission(permission: Permission): Accessor<boolean> {
  const tokenSet = useTokenPermissionSet()
  const role = useUserRole()
  return createMemo(() => tokenSet().has(permission) || hasPermission(role(), permission))
}

export function useAnyPermission(permissions: Permission[]): Accessor<boolean> {
  const tokenSet = useTokenPermissionSet()
  const role = useUserRole()
  return createMemo(
    () => permissions.some(p => tokenSet().has(p)) || hasAnyPermission(role(), permissions)
  )
}

export function useAllPermissions(permissions: Permission[]): Accessor<boolean> {
  const tokenSet = useTokenPermissionSet()
  const role = useUserRole()
  return createMemo(() => permissions.every(p => tokenSet().has(p) || hasPermission(role(), p)))
}

export function useCanAccessRoute(path: string): Accessor<boolean> {
  const role = useUserRole()
  return createMemo(() => canAccessRoute(path, role()))
}

export function useHasRoleLevel(requiredRole: Role): Accessor<boolean> {
  const role = useUserRole()
  return createMemo(() => hasRoleLevel(role(), requiredRole))
}

export function useRole(): Accessor<Role> {
  return useUserRole()
}

export function usePermissions<T extends Record<string, Permission>>(
  permissions: T
): Accessor<Record<keyof T, boolean>> {
  const tokenSet = useTokenPermissionSet()
  const role = useUserRole()
  return createMemo(() => {
    return Object.entries(permissions).reduce(
      (acc, [key, permission]) => {
        acc[key as keyof T] = tokenSet().has(permission) || hasPermission(role(), permission)
        return acc
      },
      {} as Record<keyof T, boolean>
    )
  })
}
