import type { MapEnginePort } from './port/map-engine-port.js';
import type { MapViewOptions } from './port/types.js';

/**
 * Each MFE calls this to get its own map. The `./openlayers` module is
 * dynamically imported so `ol` + `proj4` land in a separate lazy chunk.
 */
export async function createMapInstance(opts: MapViewOptions): Promise<MapEnginePort> {
  const { OlMapAdapter } = await import('./openlayers/ol-map-adapter.js');
  return new OlMapAdapter(opts);
}
