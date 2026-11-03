export { MapFeatureCollection, NetworkFeatureKind } from '@wn/contracts/map-features';
export type { MapFeatureCollection as MapFeatures, NetworkFeature, NetworkFeatureProps } from '@wn/contracts/map-features';
export type Bbox = [number, number, number, number];

/** Default viewport bbox (Hanoi area, EPSG:4326). Single source shared by the
 * viewer page and the map-canvas so their feature queries can't diverge. */
export const DEFAULT_BBOX: Bbox = [105.7, 20.9, 106.0, 21.1];

export { FeatureSearchResult, FeatureSearchResults } from '@wn/contracts/map-features';
