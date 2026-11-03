import type { GisBbox } from '@/entities/gis'
import type { Viewport } from '@wn/map-runtime-3d'

const TILE_SIZE_PX = 256
const MAX_MERCATOR_LATITUDE = 85.051129

export const VIEWPORT_POLL_MS = 150
export const VIEWPORT_DEBOUNCE_MS = 350
export const BBOX_BUFFER_RATIO = 0.2
export const MAX_QUERY_AREA_SQUARE_DEGREES = 1

interface ViewportSize {
  width: number
  height: number
}

interface ViewportBboxTrackerOptions {
  getView: () => Viewport
  /** 3D engine: exact visible ground bbox (accounts for pitch/bearing). Falls back to the top-down estimate from getView. */
  getBbox?: () => GisBbox
  target: HTMLElement
  onChange: (bbox: GisBbox) => void
  pollMs?: number
  debounceMs?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(6))
}

function longitudeToWorldX(longitude: number, worldSize: number): number {
  return ((longitude + 180) / 360) * worldSize
}

function latitudeToWorldY(latitude: number, worldSize: number): number {
  const boundedLatitude = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)
  const radians = (boundedLatitude * Math.PI) / 180
  const mercator = Math.log(Math.tan(Math.PI / 4 + radians / 2))
  return (1 / 2 - mercator / (2 * Math.PI)) * worldSize
}

function worldXToLongitude(x: number, worldSize: number): number {
  return (x / worldSize) * 360 - 180
}

function worldYToLatitude(y: number, worldSize: number): number {
  const mercator = Math.PI - (2 * Math.PI * y) / worldSize
  return (Math.atan(Math.sinh(mercator)) * 180) / Math.PI
}

function elementSize(target: HTMLElement): ViewportSize {
  const bounds = target.getBoundingClientRect()
  return {
    width: target.clientWidth || bounds.width || 1024,
    height: target.clientHeight || bounds.height || 768,
  }
}

/** Convert the current Web-Mercator view and canvas size to an EPSG:4326 bbox. */
export function viewportToBbox(view: Viewport, size: ViewportSize): GisBbox {
  const zoom = clamp(view.zoom, 0, 24)
  const worldSize = TILE_SIZE_PX * 2 ** zoom
  const centerX = longitudeToWorldX(clamp(view.center.lon, -180, 180), worldSize)
  const centerY = latitudeToWorldY(view.center.lat, worldSize)
  const halfWidth = Math.max(size.width, 1) / 2
  const halfHeight = Math.max(size.height, 1) / 2

  const minLongitude = clamp(worldXToLongitude(centerX - halfWidth, worldSize), -180, 180)
  const maxLongitude = clamp(worldXToLongitude(centerX + halfWidth, worldSize), -180, 180)
  const maxLatitude = clamp(
    worldYToLatitude(centerY - halfHeight, worldSize),
    -MAX_MERCATOR_LATITUDE,
    MAX_MERCATOR_LATITUDE
  )
  const minLatitude = clamp(
    worldYToLatitude(centerY + halfHeight, worldSize),
    -MAX_MERCATOR_LATITUDE,
    MAX_MERCATOR_LATITUDE
  )

  return [
    roundCoordinate(minLongitude),
    roundCoordinate(minLatitude),
    roundCoordinate(maxLongitude),
    roundCoordinate(maxLatitude),
  ]
}

/** Add a fetch buffer so small pans reuse the current request instead of refetching. */
export function bufferBbox(bbox: GisBbox, ratio = BBOX_BUFFER_RATIO): GisBbox {
  const longitudePadding = (bbox[2] - bbox[0]) * ratio
  const latitudePadding = (bbox[3] - bbox[1]) * ratio
  return [
    roundCoordinate(clamp(bbox[0] - longitudePadding, -180, 180)),
    roundCoordinate(
      clamp(bbox[1] - latitudePadding, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)
    ),
    roundCoordinate(clamp(bbox[2] + longitudePadding, -180, 180)),
    roundCoordinate(
      clamp(bbox[3] + latitudePadding, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)
    ),
  ]
}

export function bboxContains(outer: GisBbox, inner: GisBbox): boolean {
  return (
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  )
}

export function bboxArea(bbox: GisBbox): number {
  return Math.abs(bbox[2] - bbox[0]) * Math.abs(bbox[3] - bbox[1])
}

export function isQueryableBbox(bbox: GisBbox): boolean {
  return bboxArea(bbox) <= MAX_QUERY_AREA_SQUARE_DEGREES
}

/**
 * Track view changes through the current MapEnginePort surface. The shared port
 * exposes getView() but not moveend, so this app-level bridge samples cheaply and
 * emits only after the view has remained stable for the debounce window.
 */
export function trackViewportBbox(options: ViewportBboxTrackerOptions): () => void {
  const pollMs = options.pollMs ?? VIEWPORT_POLL_MS
  const debounceMs = options.debounceMs ?? VIEWPORT_DEBOUNCE_MS
  let previousSignature = ''
  let pendingBbox: GisBbox | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const emit = () => {
    debounceTimer = undefined
    if (stopped || !pendingBbox) return
    options.onChange(pendingBbox)
    pendingBbox = null
  }

  const sample = (immediate = false) => {
    if (stopped) return
    const bbox = options.getBbox
      ? options.getBbox()
      : viewportToBbox(options.getView(), elementSize(options.target))
    const signature = bbox.join(',')
    if (signature === previousSignature) return
    previousSignature = signature
    pendingBbox = bbox
    if (debounceTimer) clearTimeout(debounceTimer)
    if (immediate) {
      emit()
      return
    }
    debounceTimer = setTimeout(emit, debounceMs)
  }

  sample(true)
  const pollTimer = setInterval(() => sample(), pollMs)
  const onResize = () => sample()
  window.addEventListener('resize', onResize)
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
  resizeObserver?.observe(options.target)

  return () => {
    stopped = true
    clearInterval(pollTimer)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = undefined
    pendingBbox = null
    resizeObserver?.disconnect()
    window.removeEventListener('resize', onResize)
  }
}
