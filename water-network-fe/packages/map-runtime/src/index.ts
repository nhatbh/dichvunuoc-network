export type { MapEnginePort } from './port/map-engine-port.js';
export type {
  GeometryEditTarget,
  GeometryEditComplete,
  GeometryVertexSelection,
  Coordinate,
  Viewport,
  MapViewOptions,
  Extent,
  FitOptions,
  DrawGeometry,
  SnapModes,
  DrawConstraint,
  StyleSpec,
  FeatureStyle,
  StrokeSpec,
  ImageSpec,
  MarkerShape,
} from './port/types.js';
export type { BasemapId, BasemapInfo } from './basemaps.js';
export { BASEMAPS } from './basemaps.js';
export { createMapInstance } from './factory.js';
export {
  LON0,
  LAT0,
  U2M,
  M_PER_DEG_LAT,
  M_PER_DEG_LON,
  pxLon,
  pxLat,
  pxToLonLat,
  pxBboxToExtent,
  lonToPx,
  latToPx,
  lonLatToPx,
} from './pixel-affine.js';
export { LINE_TOLERANCE_M, toMapPoint, toGeoPoint, normalizeLine, splitLine, translateSegment, lineHandles } from './geometry/line-edit.js';
export type { LinePoint } from './geometry/line-edit.js';
