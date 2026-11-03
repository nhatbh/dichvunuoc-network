// 3D map engine (MapLibre GL + deck.gl) behind the same MapEnginePort as @wn/map-runtime.
// Everything the 2D package exposes is re-exported, so an app switches engines by changing one import.
export type {
  MapEnginePort,
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
  LinePoint,
} from '@wn/map-runtime';
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
  LINE_TOLERANCE_M,
  toMapPoint,
  toGeoPoint,
  normalizeLine,
  splitLine,
  translateSegment,
  lineHandles,
} from '@wn/map-runtime';

export type { Map3DPort, Camera3D, CameraOptions, CameraChangeListener, TerrainOptions, FeatureStyle3D, ContextMenuEvent } from './port/map-engine-3d-port.js';
export { MODE_2D_CAMERA, MODE_3D_CAMERA, MAX_PITCH } from './port/map-engine-3d-port.js';
export { BASEMAPS_3D, BASEMAPS_3D as BASEMAPS } from './basemaps/basemaps-3d.js';
export type { Basemap3DId, Basemap3DId as BasemapId, Basemap3DInfo, Basemap3DInfo as BasemapInfo } from './basemaps/basemaps-3d.js';
export { createMapInstance, configureMapRuntime3D } from './factory.js';
export type { MapViewOptions3D, MapRuntime3DConfig } from './factory.js';
