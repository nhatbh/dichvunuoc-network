/* GIS home — tenant-scoped data-loading entry for the rich application shell.
   Bootstrap supplies the tenant's canonical extent and summary; the map query
   then loads only that tenant's canonical GeoJSON through the authenticated BFF. */
import { createQuery } from '@tanstack/solid-query'
import { Match, Show, Switch, createMemo } from 'solid-js'
import { bootstrapQueryOptions, networkQueryOptions } from '@/entities/gis'
import { Spinner } from '@/shared/ui/spinner'
import { GisApp } from './gis-app'
import { createCanonicalGisData } from './lib/canonical-gis-data'
import { GisProvider, enrichGisData } from './lib/gis-data'
import { prepareTenantHomeView } from './lib/tenant-home-view'
import { ThemeProvider } from './lib/theme'
import { TenantGisShell } from './shell/gis-shell'
import { TenantGisState } from './tenant-gis-state'

type GisHomeState = 'loading' | 'empty' | 'invalid' | 'error' | 'ready'

export function GisHome() {
  const bootstrap = createQuery(() => bootstrapQueryOptions())
  const preparedHomeView = createMemo(() => prepareTenantHomeView(bootstrap.data?.homeView))
  const network = createQuery(() => {
    const prepared = preparedHomeView()
    return networkQueryOptions(
      prepared?.queryBbox,
      bootstrap.data?.hasData === true && prepared !== null
    )
  })
  const data = createMemo(() => {
    const summary = bootstrap.data
    const prepared = preparedHomeView()
    const networkData = network.data
    if (!summary?.hasData || !prepared || !networkData) return undefined

    return enrichGisData(
      createCanonicalGisData(
        { ...summary, homeView: prepared.homeView },
        { ...networkData, initialExtentPartial: prepared.initialExtentPartial }
      )
    )
  })
  const state = createMemo<GisHomeState>(() => {
    if (bootstrap.isError) return 'error'
    if (!bootstrap.data) return 'loading'
    if (!bootstrap.data.hasData) return 'empty'
    if (!preparedHomeView()) return 'invalid'
    if (network.isError) return 'error'
    if (!network.data || !data()) return 'loading'
    return 'ready'
  })

  const retry = () => {
    if (network.isError) {
      void network.refetch()
      return
    }
    void bootstrap.refetch()
  }

  return (
    <ThemeProvider>
      <div class="min-h-screen bg-[var(--bg)] text-[color:var(--text)]">
        <Switch>
          <Match when={state() === 'loading'}>
            <TenantGisShell>
              <div
                class="flex min-h-[60vh] items-center justify-center"
                role="status"
                aria-label="Đang tải dữ liệu GIS"
              >
                <Spinner />
              </div>
            </TenantGisShell>
          </Match>
          <Match when={state() === 'empty'}>
            <TenantGisShell>
              <TenantGisState kind="empty" class="min-h-[70vh]" />
            </TenantGisShell>
          </Match>
          <Match when={state() === 'invalid'}>
            <TenantGisShell>
              <TenantGisState kind="invalid" class="min-h-[70vh]" />
            </TenantGisShell>
          </Match>
          <Match when={state() === 'error'}>
            <TenantGisShell>
              <TenantGisState kind="error" class="min-h-[70vh]" onRetry={retry} />
            </TenantGisShell>
          </Match>
          <Match when={state() === 'ready'}>
            <Show when={data()} fallback={<Spinner />}>
              {gisData => (
                <GisProvider data={gisData()}>
                  <GisApp />
                </GisProvider>
              )}
            </Show>
          </Match>
        </Switch>
      </div>
    </ThemeProvider>
  )
}
