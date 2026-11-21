/**
 * The raster basemap the operator picked, shared by the network map and the plant's 3D view (whose ground is
 * drawn from the same tiles). The grey canvas basemaps follow the app theme.
 */
import { createSignal } from 'solid-js'

export type Basemap = 'light' | 'dark' | 'satellite' | 'osm'
export interface Raster {
  tiles: string[]
  attribution: string
  /** deepest zoom the tile server has */
  max: number
  /** ground colour shown until the tiles arrive, and past the edge of the tiled patch */
  ground: number
}

export const RASTERS: Record<Basemap, Raster> = {
  light: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'], attribution: '© Esri, HERE, Garmin, © OpenStreetMap', max: 16, ground: 0xe4e4e1 },
  dark: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], attribution: '© Esri, HERE, Garmin, © OpenStreetMap', max: 16, ground: 0x2b2c2d },
  satellite: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: '© Esri, Maxar, Earthstar Geographics', max: 19, ground: 0x4f5a42 },
  osm: { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap contributors', max: 19, ground: 0xeae6df },
}

const KEY = 'tw.map.basemap'
const darkTheme = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'

function load(): Basemap {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw === null ? null : (JSON.parse(raw) as unknown)
    if (typeof v === 'string' && v in RASTERS) return v as Basemap
  } catch {
    /* storage blocked or bad JSON: use the default */
  }
  return darkTheme() ? 'dark' : 'light'
}

const [basemap, set] = createSignal<Basemap>(load())
export { basemap }

export function setBasemap(b: Basemap) {
  set(b)
  try {
    localStorage.setItem(KEY, JSON.stringify(b))
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined')
  window.addEventListener('tw-theme', () => {
    const b = basemap()
    if (b === 'light' || b === 'dark') setBasemap(darkTheme() ? 'dark' : 'light')
  })
