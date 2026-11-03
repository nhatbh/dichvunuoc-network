/**
 * Root composition of providers. Solid edition.
 *
 * Note: MapRuntimeProvider is NOT here — it requires a `view: MapViewOptions`
 * prop and therefore lives at the per-route level (see pages/gis/map-page.tsx).
 */

import { onMount, type JSX } from 'solid-js'
import { AuthInitializer } from '@/entities/session/ui/auth-initializer'
import { SessionProvider } from '@/entities/session/ui/session-provider'
import { initMonitoring } from '@/shared/lib/monitoring'
import { initWebVitals } from '@/shared/lib/web-vitals'
import { ErrorBoundary } from '@/shared/ui/error-boundary'
import { ToastProvider } from '@/shared/ui/toast-provider'
import { EventRegistry } from './providers/event-registry'
import { QueryProvider } from './providers/query-provider'

export function Providers(props: { children: JSX.Element }) {
  onMount(() => {
    void initMonitoring()
    initWebVitals()
  })

  return (
    <ErrorBoundary>
      <QueryProvider>
        <SessionProvider>
          <AuthInitializer>
            <ToastProvider>
              <EventRegistry />
              {props.children}
            </ToastProvider>
          </AuthInitializer>
        </SessionProvider>
      </QueryProvider>
    </ErrorBoundary>
  )
}

/** Re-exported as AppProviders so brief-style imports also work. */
export { Providers as AppProviders }
