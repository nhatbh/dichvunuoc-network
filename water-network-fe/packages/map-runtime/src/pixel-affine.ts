/** Pixel ⇄ EPSG:4326 affine — the SAME transform the BFF seed-gen uses
 * (`scripts/gen-gis-seed.mjs`). The GIS design store holds the synthetic network
 * in pixel coords; this anchors it near Hanoi so it overlays real basemap tiles.
 * PLAIN math, no `ol`. */
export const LON0 = 105.8;
export const LAT0 = 21.04;
export const U2M = 1.15;
export const M_PER_DEG_LAT = 111132;
export const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

/** Pixel x → longitude (EPSG:4326). */
export const pxLon = (x: number): number => LON0 + (x * U2M) / M_PER_DEG_LON;
/** Pixel y → latitude (EPSG:4326). Y grows downward, latitude decreases. */
export const pxLat = (y: number): number => LAT0 - (y * U2M) / M_PER_DEG_LAT;

/** Pixel (x,y) → [lon, lat] GeoJSON position. */
export const pxToLonLat = (x: number, y: number): [number, number] => [pxLon(x), pxLat(y)];

/** Longitude (EPSG:4326) → pixel x. Inverse of {@link pxLon}. */
export const lonToPx = (lon: number): number => ((lon - LON0) * M_PER_DEG_LON) / U2M;
/** Latitude (EPSG:4326) → pixel y. Inverse of {@link pxLat} (latitude decreases as y grows). */
export const latToPx = (lat: number): number => ((LAT0 - lat) * M_PER_DEG_LAT) / U2M;
/** [lon, lat] GeoJSON position → pixel (x, y). Inverse of {@link pxToLonLat}. */
export const lonLatToPx = (lon: number, lat: number): [number, number] => [lonToPx(lon), latToPx(lat)];

/**
 * Convert a pixel bounding box {x,y,w,h} (top-left origin) to a geographic
 * extent [minLon, minLat, maxLon, maxLat] in EPSG:4326. Because pixel-y inverts
 * to latitude, the box's bottom edge becomes minLat.
 */
export function pxBboxToExtent(b: {
  x: number;
  y: number;
  w: number;
  h: number;
}): [number, number, number, number] {
  const lon0 = pxLon(b.x);
  const lon1 = pxLon(b.x + b.w);
  const lat0 = pxLat(b.y);
  const lat1 = pxLat(b.y + b.h);
  return [Math.min(lon0, lon1), Math.min(lat0, lat1), Math.max(lon0, lon1), Math.max(lat0, lat1)];
}
