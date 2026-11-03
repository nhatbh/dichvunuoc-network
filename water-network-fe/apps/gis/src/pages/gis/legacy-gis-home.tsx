/* Legacy GIS data boundary. This component is intentionally the only rich-app
   entry point allowed to call the seed BFF `/full` contract. */
import { createQuery } from '@tanstack/solid-query'
import { ErrorBoundary, Show } from 'solid-js'
import { httpClient } from '@/shared/api/http-client'
import { Spinner } from '@/shared/ui/spinner'
import { GisApp } from './gis-app'
import { GisProvider, enrichGisData } from './lib/gis-data'
import { parseLegacyGisData } from './lib/legacy-gis-data'
import { ThemeProvider } from './lib/theme'
import { TenantGisState } from './tenant-gis-state'

export const legacyFullQueryOptions = () => ({
  queryKey: ['gis', 'legacy', 'full'] as const,
  queryFn: async () => parseLegacyGisData(await httpClient.get<unknown>('/full')),
  staleTime: Infinity,
})

export function LegacyGisHome() {
  const full = createQuery(() => legacyFullQueryOptions())

  return (
    <ErrorBoundary
      fallback={(_, reset) => (
        <TenantGisState
            kind="error"
            class="min-h-screen"
            onRetry={() => {
              void full.refetch().then(() => reset())
            }}
        />
      )}
    >
      <Show
        when={full.data}
        fallback={
          <div class="flex min-h-screen items-center justify-center bg-[var(--bg)]">
            <Show
              when={!full.isError}
              fallback={<TenantGisState kind="error" onRetry={() => void full.refetch()} />}
            >
              <Spinner />
            </Show>
          </div>
        }
      >
        {data => (
          <ThemeProvider>
            <GisProvider data={enrichGisData(data())}>
              <GisApp />
            </GisProvider>
          </ThemeProvider>
        )}
      </Show>
    </ErrorBoundary>
  )
}
