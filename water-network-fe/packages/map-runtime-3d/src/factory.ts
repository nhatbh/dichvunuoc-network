import type { MapViewOptions } from '@wn/map-runtime';
import type { Map3DPort } from './port/map-engine-3d-port.js';

export interface MapViewOptions3D extends MapViewOptions {
  /** Initial tilt in degrees (default 0 = top-down, like the 2D engine). */
  pitch?: number;
  /** Initial bearing in degrees (default 0). */
  bearing?: number;
  /** Initial basemap id (default 'osm'). */
  basemap?: string;
  /** Initial 3D buildings (default false). */
  buildings?: boolean;
  /** Zoom (256px-tile convention) from which a tilted camera shows 3D tubes/solids (default 17.5). */
  solidsMinZoom?: number;
  /** Show the compact tile attribution control (default true). */
  attribution?: boolean;
}

export interface MapRuntime3DConfig {
  /**
   * URL of MapLibre 6's worker script. Under Vite:
   * `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'`.
   */
  workerUrl?: string;
}

let config: MapRuntime3DConfig = {};

/** Call once at startup, before the first map is created. */
export function configureMapRuntime3D(next: MapRuntime3DConfig): void {
  config = { ...config, ...next };
}

/**
 * Create the 3D engine. `maplibre-gl`, `deck.gl` and the engine are dynamically
 * imported so they land in one lazy chunk (the app shell stays small).
 */
export async function createMapInstance(opts: MapViewOptions3D): Promise<Map3DPort> {
  const [{ MapLibreHost }, { MapEngine3D }] = await Promise.all([import('./host/maplibre-host.js'), import('./core/engine.js')]);
  const host = new MapLibreHost({ ...opts, workerUrl: config.workerUrl });
  const engine = new MapEngine3D(host, { solidsMinZoom: opts.solidsMinZoom });
  if (opts.buildings) engine.setBuildings(true);
  return engine;
}
