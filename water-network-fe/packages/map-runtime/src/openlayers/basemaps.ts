import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import type TileSource from 'ol/source/Tile';
import type { BasemapId } from '../basemaps.js';

/** Build the `ol` tile source for a basemap id. `none` → null (blank background). */
export function createBasemapSource(id: BasemapId): TileSource | null {
  switch (id) {
    case 'osm':
      return new OSM();
    case 'carto-light':
      return new XYZ({
        url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors, © CARTO',
      });
    case 'carto-dark':
      return new XYZ({
        url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors, © CARTO',
      });
    case 'satellite':
      return new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      });
    case 'none':
      return null;
  }
}
