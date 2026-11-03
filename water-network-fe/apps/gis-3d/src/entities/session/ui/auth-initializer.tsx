/**
 * Auth Initializer
 *
 * Shows a loading skeleton while Keycloak initializes,
 * then renders children or an error fallback.
 * No-ops for mock auth mode (instant ready).
 */

import { Match, Switch, type JSX } from 'solid-js'
import { env } from '@/shared/config/env'
import { useSessionContext } from './session-provider'

interface AuthInitializerProps {
  children: JSX.Element
}

export function AuthInitializer(props: AuthInitializerProps) {
  const sessionCtx = useSessionContext()

  return (
    <Switch>
      <Match when={env.VITE_AUTH_MODE !== 'keycloak'}>{props.children}</Match>
      <Match when={sessionCtx.isLoading()}>
        <div class="flex min-h-screen items-center justify-center bg-background">
          <div class="flex flex-col items-center gap-4">
            <div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
            <p class="text-sm text-muted-foreground">Initializing authentication...</p>
          </div>
        </div>
      </Match>
      <Match when={sessionCtx.error()}>
        <div class="flex min-h-screen items-center justify-center bg-background">
          <div class="max-w-md text-center px-4">
            <h2 class="text-lg font-semibold text-destructive">Authentication Error</h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {sessionCtx.error()?.message || 'Unable to connect to the authentication service.'}
            </p>
            <button
              class="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        </div>
      </Match>
      <Match when={!sessionCtx.isLoading()}>{props.children}</Match>
    </Switch>
  )
}
