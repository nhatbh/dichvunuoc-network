import { createMapInstance, type Map3DPort } from '@wn/map-runtime-3d'
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { FeatureCollection } from 'geojson'

type Ring = Array<[number, number]>

function extentOf(collections: FeatureCollection[]): [number, number, number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const collection of collections)
    for (const feature of collection.features) {
      const g = feature.geometry
      const pairs =
        g.type === 'Point'
          ? [g.coordinates]
          : g.type === 'LineString'
            ? g.coordinates
            : g.type === 'Polygon'
              ? g.coordinates.flat()
              : []
      for (const [x, y] of pairs as number[][]) {
        minX = Math.min(minX, x!)
        minY = Math.min(minY, y!)
        maxX = Math.max(maxX, x!)
        maxY = Math.max(maxY, y!)
      }
    }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
}

/**
 * The drawing on the basemap: the importer's proposed extent (dashed outline, computed by the
 * import service) and, once a CRS is saved, the server-projected network itself.
 */
export function LocationMap(props: {
  footprint: Ring | null
  network: FeatureCollection | null
}): JSX.Element {
  let container!: HTMLDivElement
  let disposed = false
  const [port, setPort] = createSignal<Map3DPort | null>(null)
  const [failed, setFailed] = createSignal(false)
  const [basemap, setBasemap] = createSignal<'osm' | 'satellite'>('osm')
  onMount(async () => {
    try {
      const instance = await createMapInstance({
        center: { lon: 106, lat: 16 },
        zoom: 5,
        minZoom: 2,
        maxZoom: 21,
      })
      if (disposed) return instance.destroy()
      instance.mount(container)
      setPort(instance)
    } catch {
      if (!disposed) setFailed(true)
    }
  })
  onCleanup(() => {
    disposed = true
    port()?.destroy()
  })
  createEffect(() => port()?.setBasemap(basemap()))
  let lastFit = ''
  createEffect(() => {
    const instance = port()
    if (!instance) return
    const outline: FeatureCollection = {
      type: 'FeatureCollection',
      features: props.footprint
        ? [
            {
              type: 'Feature',
              id: 'drawing-extent',
              geometry: { type: 'LineString', coordinates: props.footprint },
              properties: {},
            },
          ]
        : [],
    }
    const network = props.network ?? { type: 'FeatureCollection', features: [] }
    instance.setFeatures('drawing-extent', outline, () => ({
      stroke: { color: '#d97706', width: 2, dash: [6, 4] },
    }))
    instance.setFeatures('drawing-network', network, () => ({
      stroke: { color: '#0369a1', width: 2.5 },
      image: { shape: 'circle', radius: 3, color: '#0369a1' },
    }))
    const extent = extentOf(network.features.length ? [network] : [outline])
    const key = extent?.map(v => v.toFixed(5)).join(',') ?? ''
    if (extent && key !== lastFit) {
      lastFit = key
      instance.fitToBbox(extent, { padding: 60, maxZoom: 18 })
    }
  })
  return (
    <div class="guided-map">
      <div ref={container} class="guided-map-canvas" aria-label="Bản đồ vị trí bản vẽ" />
      <div class="guided-map-tools">
        <button type="button" aria-pressed={basemap() === 'osm'} onClick={() => setBasemap('osm')}>
          Bản đồ
        </button>
        <button
          type="button"
          aria-pressed={basemap() === 'satellite'}
          onClick={() => setBasemap('satellite')}
        >
          Vệ tinh
        </button>
      </div>
      <div class="guided-map-legend">
        <Show when={props.footprint}>
          <span>
            <i class="guided-swatch guided-swatch-extent" /> Phạm vi bản vẽ
          </span>
        </Show>
        <Show when={props.network?.features.length}>
          <span>
            <i class="guided-swatch guided-swatch-network" /> Mạng lưới đã quy đổi
          </span>
        </Show>
      </div>
      <Show when={failed()}>
        <p class="guided-map-error">
          Chưa tải được bản đồ nền; vẫn có thể xác nhận theo căn cứ bên cạnh.
        </p>
      </Show>
    </div>
  )
}
