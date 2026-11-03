import { createQuery } from '@tanstack/solid-query'
import { createMapRuntime } from '@wn/map-runtime/solid'
import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js'
import { AppShell } from '@/widgets/app-shell/app-shell'
import { AssetInspector } from '@/widgets/asset-inspector/asset-inspector'
import { LayerPanel } from '@/widgets/layer-panel/layer-panel'
import type { GisBbox, GisLayerId } from '@/entities/gis'
import {
  bootstrapQueryOptions,
  layersQueryOptions,
  networkQueryOptions,
} from '@/entities/gis/queries'
import { Spinner } from '@/shared/ui/spinner'
import { prepareTenantHomeView, type PreparedTenantHomeView } from './lib/tenant-home-view'
import { bboxContains, bufferBbox, isQueryableBbox, trackViewportBbox } from './lib/viewport-bbox'
import { TenantGisState } from './tenant-gis-state'
import type { Feature, FeatureCollection } from 'geojson'

const VIEWER_LAYER_IDS = ['pipe', 'node', 'valve', 'hydrant', 'source'] as const
const EMPTY_FEATURES: FeatureCollection = { type: 'FeatureCollection', features: [] }

interface ViewportRequest {
  bbox: GisBbox
  queryable: boolean
}

function sameBbox(left: GisBbox, right: GisBbox): boolean {
  return left.every((value, index) => value === right[index])
}

export function MapPage() {
  const bootstrap = createQuery(() => bootstrapQueryOptions())
  const preparedHomeView = createMemo(() => prepareTenantHomeView(bootstrap.data?.homeView))

  return (
    <AppShell active="map">
      <Switch fallback={<TenantGisState kind="invalid" class="h-[calc(100vh-53px)]" />}>
        <Match when={bootstrap.isError}>
          <TenantGisState
            kind="error"
            class="h-[calc(100vh-53px)]"
            onRetry={() => void bootstrap.refetch()}
          />
        </Match>
        <Match when={!bootstrap.data}>
          <div class="flex h-[calc(100vh-53px)] items-center justify-center">
            <Spinner />
          </div>
        </Match>
        <Match when={bootstrap.data?.hasData === false}>
          <TenantGisState kind="empty" class="h-[calc(100vh-53px)]" />
        </Match>
        <Match when={bootstrap.data?.hasData === true && !preparedHomeView()}>
          <TenantGisState kind="invalid" class="h-[calc(100vh-53px)]" />
        </Match>
        <Match when={bootstrap.data?.hasData === true && preparedHomeView()}>
          <Show when={preparedHomeView()}>{home => <TenantMapViewer homeView={home()} />}</Show>
        </Match>
      </Switch>
    </AppShell>
  )
}

function TenantMapViewer(props: { homeView: PreparedTenantHomeView }) {
  const initialTenantView = untrack(() => ({
    center: { ...props.homeView.homeView.center },
    zoom: 12,
  }))
  const [viewportRequest, setViewportRequest] = createSignal<ViewportRequest | null>(null)
  const [homeViewApplied, setHomeViewApplied] = createSignal(false)
  const net = createQuery(() => {
    const request = viewportRequest()
    return networkQueryOptions(
      request?.bbox ?? props.homeView.queryBbox,
      request?.queryable === true
    )
  })
  const layers = createQuery(() => layersQueryOptions())
  const { containerRef, port } = createMapRuntime({ view: initialTenantView })
  const [vis, setVis] = createSignal<Record<string, boolean>>({})
  const [selected, setSelected] = createSignal<Feature | null>(null)
  let mapElement: HTMLDivElement | undefined

  const mapRef = (element: HTMLDivElement) => {
    mapElement = element
    containerRef(element)
  }

  // A cached or late response is safe to display only when it belongs to the
  // active request. Spatial data from a previous bbox must never be painted as
  // if it represented the current viewport.
  const currentNetworkData = createMemo(() => {
    const request = viewportRequest()
    const data = net.data
    if (!request?.queryable || !data || !sameBbox(request.bbox, data.bbox)) return undefined
    return data
  })

  const visibleLayers = createMemo(() =>
    layers.data?.map(layer => ({
      ...layer,
      count: currentNetworkData()?.layers[layer.id as GisLayerId]?.features.length ?? 0,
    }))
  )

  // Bootstrap is authoritative for each tenant's home extent. Apply it before
  // starting viewport tracking so the first /map request can never be derived
  // from the deploy-time fallback (historically Hanoi).
  let fittedTenantHome = false
  createEffect(() => {
    const p = port()
    if (!p || fittedTenantHome) return
    fittedTenantHome = true
    const [minLon, minLat, maxLon, maxLat] = props.homeView.homeView.bbox
    p.fitToBbox([minLon, minLat, maxLon, maxLat], { padding: 64, maxZoom: 17 })
    setHomeViewApplied(true)
  })

  // MapEnginePort currently exposes getView() but no moveend event. Bridge that
  // narrow API here and commit a buffered bbox only after the viewport settles.
  createEffect(() => {
    const p = port()
    const target = mapElement
    if (!p || !target || !homeViewApplied()) return

    const stop = trackViewportBbox({
      getView: () => p.getView(),
      target,
      onChange: visibleBbox => {
        const current = untrack(viewportRequest)
        const truncated = untrack(() => currentNetworkData()?.truncated === true)

        // The request has a 20% buffer. Reuse it while the viewport stays inside,
        // unless the server truncated that response (zooming in must then retry).
        if (current?.queryable && !truncated && bboxContains(current.bbox, visibleBbox)) return

        const bbox = bufferBbox(visibleBbox)
        const next = { bbox, queryable: isQueryableBbox(bbox) }
        if (current && current.queryable === next.queryable && sameBbox(current.bbox, next.bbox)) {
          return
        }
        setViewportRequest(next)
      },
    })

    onCleanup(stop)
  })

  // Set basemap once when the port first becomes non-null.
  // Kept separate from the feature-loading effect so a background data refetch
  // does NOT clobber a user-selected basemap later.
  createEffect(() => {
    const p = port()
    if (!p) return
    p.setBasemap('none')
  })

  // Load features into map once both port and data are available
  createEffect(() => {
    const p = port()
    const request = viewportRequest()
    const data = currentNetworkData()
    if (!p) return

    // Clear on an unsafe viewport and during a bbox transition. The latter also
    // protects the map if an older request resolves after the viewport changed.
    if (!request?.queryable || !data) {
      for (const layerId of VIEWER_LAYER_IDS) p.setFeatures(layerId, EMPTY_FEATURES)
      p.setSelection(null)
      setSelected(null)
      return
    }

    for (const layerId of VIEWER_LAYER_IDS) {
      p.setFeatures(layerId, data.layers[layerId] ?? EMPTY_FEATURES)
    }
  })

  // Initialise vis from layers.on (only once).
  // Phase-1 one-shot init guard: Object.keys(vis()).length prevents re-init once
  // layers are loaded. Revisit if layers become dynamic (added/removed at runtime).
  createEffect(() => {
    if (!layers.data || Object.keys(vis()).length) return
    setVis(Object.fromEntries(layers.data.map(l => [l.id, l.on])))
  })

  // Apply visibility changes to map
  createEffect(() => {
    const p = port()
    if (!p) return
    for (const [id, on] of Object.entries(vis())) {
      p.setLayerVisible(id, on)
    }
  })

  // Register onFeatureClick once, when port first becomes non-null
  // Uses createEffect with a guard to avoid re-registering on every render
  createEffect(() => {
    const p = port()
    if (!p) return

    // Register click handler — p.onFeatureClick returns an unsubscribe fn.
    // net.data is read live at click time (not captured at registration) — safe
    // because `net` is a stable TanStack Query object whose .data accessor is
    // always current.
    const unsub = p.onFeatureClick(fid => {
      const data = untrack(currentNetworkData)
      if (!data) return
      for (const fc of Object.values(data.layers)) {
        const f = fc?.features.find((x: Feature) => String(x.id) === String(fid))
        if (f) {
          setSelected(f)
          p.setSelection(fid)
          return
        }
      }
    })

    // onCleanup is called when port() changes (e.g. map destroyed/rebuilt),
    // preventing stale click handlers from accumulating.
    onCleanup(unsub)
  })

  const toggle = (id: string) => setVis(v => ({ ...v, [id]: !v[id] }))
  const closeInspector = () => {
    setSelected(null)
    port()?.setSelection(null)
  }

  return (
    <div class="flex h-[calc(100vh-53px)] min-h-0">
      <Show when={visibleLayers()}>
        <LayerPanel layers={visibleLayers()!} vis={vis()} onToggle={toggle} />
      </Show>
      <div class="relative min-w-0 flex-1">
        <div
          ref={mapRef}
          data-testid="canonical-map"
          class="absolute inset-0 transition-opacity"
          classList={{ 'opacity-0': !homeViewApplied() }}
        />

        <div
          class="pointer-events-none absolute right-3 top-3 z-10 flex max-w-sm flex-col items-end gap-2"
          aria-live="polite"
        >
          <Show when={!homeViewApplied() || !viewportRequest()}>
            <div
              role="status"
              class="rounded border border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm"
            >
              Đang khởi tạo khung nhìn…
            </div>
          </Show>

          <Show when={viewportRequest()?.queryable === false}>
            <div
              role="status"
              class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm"
            >
              Khu vực đang hiển thị quá rộng. Phóng to để tải dữ liệu mạng lưới.
            </div>
          </Show>

          <Show when={viewportRequest()?.queryable && net.isPending}>
            <div
              role="status"
              class="rounded border border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm"
            >
              Đang tải dữ liệu trong khung nhìn…
            </div>
          </Show>

          <Show when={net.isFetching && !net.isPending}>
            <div
              role="status"
              class="rounded border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
            >
              Đang cập nhật khung nhìn…
            </div>
          </Show>

          <Show when={net.isError && viewportRequest()?.queryable}>
            <div
              role="alert"
              class="pointer-events-auto flex items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 shadow-sm"
            >
              <span>Không thể tải dữ liệu bản đồ.</span>
              <button
                type="button"
                class="font-semibold underline"
                onClick={() => void net.refetch()}
              >
                Thử lại
              </button>
            </div>
          </Show>

          <Show when={currentNetworkData()?.truncated && !net.isFetching}>
            <div
              role="status"
              class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm"
            >
              Đã đạt giới hạn {currentNetworkData()?.limit.toLocaleString('vi-VN')} đối tượng. Phóng
              to để xem đầy đủ khu vực cần thiết.
            </div>
          </Show>
        </div>

        <Show when={currentNetworkData()}>
          <div class="pointer-events-none absolute bottom-3 right-3 z-10 rounded border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
            {currentNetworkData()?.featureCount.toLocaleString('vi-VN')} đối tượng
          </div>
        </Show>
      </div>
      <Show when={selected()}>
        <AssetInspector feature={selected()} onClose={closeInspector} />
      </Show>
    </div>
  )
}
