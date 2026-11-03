/**
 * Declarative Authorization Components
 *
 * Solid components for conditionally rendering UI based on
 * roles and permissions without imperative checks.
 *
 * Usage:
 * ```tsx
 * <ShowRole role="admin">
 *   <AdminPanel />
 * </ShowRole>
 *
 * <ShowPermission permission="delete:post">
 *   <DeleteButton />
 * </ShowPermission>
 * ```
 */

import { createMemo, Match, Show, Switch, type JSX } from 'solid-js'
import { authClient } from '@/shared/lib/client-auth'
import type { Permission, Role } from '@/shared/lib/permissions'

/**
 * Show content only when the current user has the specified role.
 */
export function ShowRole(props: { role: Role; fallback?: JSX.Element; children: JSX.Element }) {
  const hasRole = createMemo(() => {
    let result = false
    void authClient.hasRole(props.role).then(r => (result = r))
    return result
  })

  return (
    <Show when={hasRole()} fallback={props.fallback}>
      {props.children}
    </Show>
  )
}

/**
 * Show content only when the current user has the specified permission.
 */
export function ShowPermission(props: {
  permission: Permission | string
  fallback?: JSX.Element
  children: JSX.Element
}) {
  const hasPermission = createMemo(() => {
    let result = false
    void authClient.hasPermission(props.permission).then(r => (result = r))
    return result
  })

  return (
    <Show when={hasPermission()} fallback={props.fallback}>
      {props.children}
    </Show>
  )
}

/**
 * Show content only when the user is authenticated.
 */
export function ShowAuthenticated(props: {
  fallback?: JSX.Element
  children: JSX.Element
}) {
  const isAuthenticated = createMemo(() => {
    let result = false
    void authClient.getSession().then(s => (result = s !== null))
    return result
  })

  return (
    <Show when={isAuthenticated()} fallback={props.fallback}>
      {props.children}
    </Show>
  )
}

/**
 * Render different content based on the user's highest role.
 * Useful for role-specific dashboards or navigation.
 */
export function RoleSwitch(props: {
  admin?: JSX.Element
  moderator?: JSX.Element
  user?: JSX.Element
  guest?: JSX.Element
}) {
  const role = createMemo((): string => {
    let currentRole = 'guest'
    void authClient.getSession().then(session => {
      if (session?.user?.roles?.length) {
        currentRole = session.user.roles[0]!
      }
    })
    return currentRole
  })

  return (
    <Switch>
      <Match when={role() === 'admin'}>{props.admin}</Match>
      <Match when={role() === 'moderator'}>{props.moderator}</Match>
      <Match when={role() === 'user'}>{props.user}</Match>
      <Match when={role() === 'guest'}>{props.guest}</Match>
    </Switch>
  )
}
