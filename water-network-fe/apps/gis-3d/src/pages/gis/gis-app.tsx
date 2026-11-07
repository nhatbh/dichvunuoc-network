/* Bản đồ mạng lưới GIS — App shell (SolidJS port of app.jsx App()).
   Sidebar + mobile drawer + topbar + in-app router (route.name signal) +
   toasts + ⌘K command palette + theme effects. Home route = Dashboard. */
import { Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js'
import { scLoadBranches, scSaveBranches, type Branch } from './lib/branch-store'
import { useGis } from './lib/gis-data'
import { AssetsScreen } from './screens/assets'
import { ConnectionsScreen } from './screens/connections'
import { DashboardScreen } from './screens/dashboard'
import { EditorScreen } from './screens/editor'
import { FieldScreen } from './screens/field'
import { ImportScreen } from './screens/import'
import {
  AssetSearch,
  AtlasHost,
  BaseMapOverlay,
  InspectorDrawer,
  LayersPanel,
  MapToolButtons,
  MapViewProvider,
  MeasurePill,
  PartialNetworkBanner,
  QueryPanelHost,
  useMapView,
} from './screens/map'
import { NetModelScreen } from './screens/netmodel'
import { PlaceholderScreen } from './screens/placeholder'
import { QualityScreen } from './screens/quality'
import { ScenariosScreen } from './screens/scenarios'
import { TopologyScreen } from './screens/topology'
import { TraceScreen } from './screens/trace'
import { VersionsScreen } from './screens/versions'
import { LeaksScreen } from './screens/leaks'
import { OpsScreen } from './screens/ops'
import { ProductionScreen } from './screens/production'
import { SensorScreen } from './screens/sensor'
import { OpsProvider, useOpsMaybe } from './ops/ops-context'
import { OpsMapBridge, TimeBar } from './ops/time-bar'
import { GisShell } from './shell/gis-shell'
import { MapStageProvider } from './shell/map-stage'
import { NAV, PANELS, TITLES } from './shell/nav'
import { NetworkHud, TopologyBanner } from './shell/network-hud'
import { StageMap } from './shell/stage-map'
import { ToastHost, type Toast } from './ui/kit'
import type { Route } from './shell/nav'

const iconOf = (name: string): string => {
  for (const p of PANELS) if (p.id === name) return p.icon
  for (const g of NAV) for (const it of g.items) if (it.id === name) return it.icon
  return 'IcGridSq'
}

const CANONICAL_SUPPORTED_ROUTES = new Set([
  'dashboard',
  'map',
  'layers',
  'query',
  'assets',
  'import',
])

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
    // `#sensor:D-0012` / `#leaks:MK-EV-1` carry the item the ops panels open
    const [h = '', param] = (window.location.hash || '').replace(/^#/, '').split(':')
    const name = h && TITLES[h] ? h : 'map'
    return {
      name,
      ...(param && name === 'sensor' ? { sensor: decodeURIComponent(param) } : {}),
      ...(param && name === 'leaks' ? { marker: decodeURIComponent(param) } : {}),
    }
  }

  const onHashChange = () =>
    setRoute(current => {
      const next = initialRoute()
      return next.name === current.name && next.sensor === current.sensor && next.marker === current.marker ? current : next
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
    const param = r.sensor ?? r.marker
    window.location.hash = param ? `${r.name}:${encodeURIComponent(param)}` : r.name
  }

  const counts = createMemo<Record<string, number>>(() => ({
    topo: G.DASH.topoOpen,
    cs: G.DASH.csPending,
    imp: G.DASH.importPending,
    field: G.DASH.fieldPending,
  }))

  // the operations layer (sensors, readings, markers) is served for the seeded demo network
  const Ops = (p: { children: JSX.Element }) => (G.canonical ? p.children : <OpsProvider>{p.children}</OpsProvider>)

  return (
    <MapStageProvider>
      <Ops>
      <MapViewProvider focusAsset={route().focusAsset}>
        <BaseMapOverlay />
        <GisShell
          route={route()}
          go={go}
          counts={counts()}
          stage={<StageMap />}
          hud={<NetworkHud go={go} />}
          search={<AssetSearch />}
          tools={<MapToolButtons />}
          overlay={<MapOverlays route={route()} go={go} toast={toast} />}
        >
          <Switch
            fallback={<PlaceholderScreen name={route().name} icon={iconOf(route().name)} go={go} />}
          >
            <Match when={route().name === 'map'}>{null}</Match>
            <Match when={G.canonical && !CANONICAL_SUPPORTED_ROUTES.has(route().name)}>
              <PlaceholderScreen name={route().name} icon={iconOf(route().name)} go={go} />
            </Match>
            <Match when={route().name === 'layers'}>
              <LayersPanel />
            </Match>
            <Match when={route().name === 'query'}>
              <QueryPanelHost toast={toast} />
            </Match>
            <Match when={route().name === 'dashboard'}>
              <DashboardScreen go={go} toast={toast} />
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
            <Match when={route().name === 'ops'}>
              <OpsScreen go={go} />
            </Match>
            <Match when={route().name === 'sensor'}>
              <SensorScreen sensorId={route().sensor} go={go} toast={toast} />
            </Match>
            <Match when={route().name === 'leaks'}>
              <LeaksScreen markerId={route().marker} go={go} toast={toast} />
            </Match>
            <Match when={route().name === 'production'}>
              <ProductionScreen toast={toast} />
            </Match>
          </Switch>
        </GisShell>
        <AtlasHost toast={toast} />
        <ToastHost toasts={toasts()} />
      </MapViewProvider>
      </Ops>
    </MapStageProvider>
  )
}

/** Everything floating over the map that is not a panel. */
function MapOverlays(props: {
  route: Route
  go: (r: Route) => void
  toast: (m: string, k?: string) => void
}) {
  const v = useMapView()
  const ops = useOpsMaybe()
  const isSensor = (sel: { type: string; id: string }) => sel.type === 'device' && !!ops?.sensorById().has(sel.id)
  // a sensor picked on the map opens its 24 h chart rather than the asset inspector
  createEffect(
    on(v.sel, sel => {
      if (sel && isSensor(sel)) props.go({ name: 'sensor', sensor: sel.id })
    })
  )
  return (
    <>
      <InspectorDrawer go={props.go} toast={props.toast} skip={isSensor} />
      <Show when={ops}>
        <OpsMapBridge />
        <Show when={!v.measuring()}>
          <TimeBar />
        </Show>
      </Show>
      <MeasurePill />
      <Show when={!v.measuring()}>
        <PartialNetworkBanner />
        <TopologyBanner route={props.route} go={props.go} />
      </Show>
    </>
  )
}
