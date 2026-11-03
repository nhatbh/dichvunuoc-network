import { BASEMAPS, type BasemapInfo } from '@wn/map-runtime';

/** 2D basemap ids plus the vector 3D style. Plain data — safe to import without the engine chunk. */
export type Basemap3DId = 'osm' | 'carto-light' | 'carto-dark' | 'satellite' | 'none' | 'liberty';

export interface Basemap3DInfo extends Omit<BasemapInfo, 'id'> {
  id: Basemap3DId;
}

/**
 * Same catalogue as the 2D engine plus "OpenFreeMap 3D" (vector tiles with labels
 * and building footprints). NOTE for deploy: nginx `img-src`/`connect-src` must allow
 * tiles.openfreemap.org, plus s3.amazonaws.com for terrain (see apps/gis-3d/nginx.conf.template).
 */
export const BASEMAPS_3D: readonly Basemap3DInfo[] = [
  ...(BASEMAPS as readonly BasemapInfo[]).map((b) => ({ ...b, id: b.id as Basemap3DId })),
  { id: 'liberty', label: 'OpenFreeMap 3D' },
];

export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const OPENFREEMAP_TILES = 'https://tiles.openfreemap.org/planet';
/** Free global terrain tiles (Mapzen / AWS Terrain Tiles, "terrarium" encoding). */
export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

interface RasterDef {
  tiles: string[];
  maxzoom: number;
  attribution: string;
  background: string;
  dark: boolean;
}

const RASTERS: Record<Exclude<Basemap3DId, 'none' | 'liberty'>, RasterDef> = {
  osm: {
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: '© OpenStreetMap contributors',
    background: '#e8e6e0',
    dark: false,
  },
  'carto-light': {
    tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`),
    maxzoom: 20,
    attribution: '© OpenStreetMap contributors, © CARTO',
    background: '#eef0f2',
    dark: false,
  },
  'carto-dark': {
    tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
    maxzoom: 20,
    attribution: '© OpenStreetMap contributors, © CARTO',
    background: '#1c1f24',
    dark: true,
  },
  satellite: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
    background: '#0b1118',
    dark: true,
  },
};

export const isDarkBasemap = (id: string): boolean => id === 'carto-dark' || id === 'satellite';

/** MapLibre style for a basemap id: a URL for the vector style, otherwise an inline style object. */
export function basemapStyle(id: string): string | { version: 8; sources: Record<string, unknown>; layers: unknown[] } {
  if (id === 'liberty') return OPENFREEMAP_STYLE;
  const def = RASTERS[id as keyof typeof RASTERS];
  if (!def) return { version: 8, sources: {}, layers: [{ id: 'wn-bg', type: 'background', paint: { 'background-color': '#f1f3f5' } }] };
  return {
    version: 8,
    sources: { 'wn-base': { type: 'raster', tiles: def.tiles, tileSize: 256, maxzoom: def.maxzoom, attribution: def.attribution } },
    layers: [
      { id: 'wn-bg', type: 'background', paint: { 'background-color': def.background } },
      { id: 'wn-base', type: 'raster', source: 'wn-base' },
    ],
  };
}
