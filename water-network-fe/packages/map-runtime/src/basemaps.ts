/** Basemap catalog — PLAIN data, no `ol`. Consumed by layer-control for labels
 * without pulling the engine chunk. The `ol` source factory lives in
 * `openlayers/basemaps.ts` behind the lazy adapter chunk.
 *
 * NOTE for deploy: the app's nginx.conf.template `img-src` must allow every tile
 * host below or tiles are blocked by CSP. Currently allowed:
 *   *.tile.openstreetmap.org, *.basemaps.cartocdn.com, server.arcgisonline.com
 * (carto-dark reuses the cartocdn host; satellite needs server.arcgisonline.com). */
export type BasemapId = 'osm' | 'carto-light' | 'carto-dark' | 'satellite' | 'none';

export interface BasemapInfo {
  id: BasemapId;
  label: string;
}

export const BASEMAPS: readonly BasemapInfo[] = [
  { id: 'carto-light', label: 'Carto Light' },
  { id: 'carto-dark', label: 'Carto Dark' },
  { id: 'osm', label: 'OSM Standard' },
  { id: 'satellite', label: 'Vệ tinh' },
  { id: 'none', label: 'None' },
];
