/* Bản đồ mạng lưới GIS — App shell (SolidJS port of app.jsx App()).
   Sidebar + mobile drawer + topbar + in-app router (route.name signal) +
   toasts + ⌘K command palette + theme effects. Home route = Dashboard. */
import { Match, Switch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { scLoadBranches, scSaveBranches, type Branch } from './lib/branch-store'
import { useGis } from './lib/gis-data'
import { AssetsScreen } from './screens/assets'
import { ConnectionsScreen } from './screens/connections'
import { DashboardScreen } from './screens/dashboard'
import { EditorScreen } from './screens/editor'
import { FieldScreen } from './screens/field'
import { ImportScreen } from './screens/import'
import { MapScreen } from './screens/map'
import { NetModelScreen } from './screens/netmodel'
import { PlaceholderScreen } from './screens/placeholder'
import { QualityScreen } from './screens/quality'
import { ScenariosScreen } from './screens/scenarios'
import { TopologyScreen } from './screens/topology'
import { TraceScreen } from './screens/trace'
import { VersionsScreen } from './screens/versions'
import { GisShell } from './shell/gis-shell'
import { NAV, TITLES } from './shell/nav'
import { ToastHost, type Toast } from './ui/kit'
import type { Route } from './shell/nav'

const iconOf = (name: string): string => {
  for (const g of NAV) for (const it of g.items) if (it.id === name) return it.icon
  return 'IcGridSq'
}

const CANONICAL_SUPPORTED_ROUTES = new Set(['dashboard', 'map', 'assets', 'import'])

export function GisApp() {
  const G = useGis()
  const [route, setRoute] = createSignal<Route>(initialRoute())
  const [toasts, setToasts] = createSignal<Toast[]>([])
  const [branches, setBranches] = createSignal<Branch[]>(G.canonical ? [] : scLoadBranches())

  // The legacy branch store is global and not tenant-scoped. Canonical tenants
  // must not seed or persist data there until a tenant-aware service exists.
  createEffect(() => {
    if (!G.canonical) scSaveBranches(branches())
  })

  function initialRoute(): Route {
    const h = (window.location.hash || '').replace(/^#/, '')
    return { name: h && TITLES[h] ? h : 'dashboard' }
  }

  const onHashChange = () =>
    setRoute(current => {
      const next = initialRoute()
      return next.name === current.name ? current : next
    })
  window.addEventListener('hashchange', onHashChange)
  onCleanup(() => window.removeEventListener('hashchange', onHashChange))

  const toast = (msg: string, kind: string = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(a => [...a, { id, msg, kind: kind as Toast['kind'] }])
    setTimeout(() => setToasts(a => a.filter(x => x.id !== id)), 3400)
  }

  const go = (r: Route) => {
    setRoute(r)
    window.location.hash = r.name
    window.scrollTo(0, 0)
  }

  const counts = createMemo<Record<string, number>>(() => ({
    topo: G.DASH.topoOpen,
    cs: G.DASH.csPending,
    imp: G.DASH.importPending,
    field: G.DASH.fieldPending,
  }))

  return (
    <>
      <GisShell route={route()} go={go} counts={counts()}>
        <Switch
          fallback={<PlaceholderScreen name={route().name} icon={iconOf(route().name)} go={go} />}
        >
          <Match when={G.canonical && !CANONICAL_SUPPORTED_ROUTES.has(route().name)}>
            <PlaceholderScreen name={route().name} icon={iconOf(route().name)} go={go} />
          </Match>
          <Match when={route().name === 'dashboard'}>
            <DashboardScreen go={go} toast={toast} />
          </Match>
          <Match when={route().name === 'map'}>
            <MapScreen
              toast={toast}
              go={go}
              focusAsset={route().focusAsset}
              openQuery={route().openQuery}
            />
          </Match>
          <Match when={route().name === 'editor'}>
            <EditorScreen
              toast={toast}
              go={go}
              branchId={route().branch}
              importJob={route().importJob}
              branches={branches()}
              setBranches={setBranches}
            />
          </Match>
          <Match when={route().name === 'assets'}>
            <AssetsScreen toast={toast} go={go} />
          </Match>
          <Match when={route().name === 'topology'}>
            <TopologyScreen toast={toast} />
          </Match>
          <Match when={route().name === 'trace'}>
            <TraceScreen toast={toast} />
          </Match>
          <Match when={route().name === 'netmodel'}>
            <NetModelScreen toast={toast} go={go} />
          </Match>
          <Match when={route().name === 'connections'}>
            <ConnectionsScreen toast={toast} />
          </Match>
          <Match when={route().name === 'import'}>
            <ImportScreen
              toast={toast}
              go={go}
              branchId={route().branch}
              branches={branches()}
              setBranches={setBranches}
            />
          </Match>
          <Match when={route().name === 'quality'}>
            <QualityScreen toast={toast} go={go} />
          </Match>
          <Match when={route().name === 'field'}>
            <FieldScreen toast={toast} />
          </Match>
          <Match when={route().name === 'scenarios'}>
            <ScenariosScreen
              toast={toast}
              go={go}
              branches={branches()}
              setBranches={setBranches}
            />
          </Match>
          <Match when={route().name === 'versions'}>
            <VersionsScreen toast={toast} />
          </Match>
        </Switch>
      </GisShell>
      <ToastHost toasts={toasts()} />
    </>
  )
}
