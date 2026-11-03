import type { Geometry } from 'geojson';
export interface Coordinate { lon: number; lat: number }
export interface Viewport { center: Coordinate; zoom: number }

/** Chuột phải trên bản đồ: feature bị trúng (null nếu nền trống) + toạ độ + pixel. */
export interface ContextMenuEvent {
  featureId: string | null;
  coordinate: Coordinate;
  pixel: [number, number];
}

export interface MapViewOptions {
  center: Coordinate;
  zoom: number;
  /** View projection EPSG code; defaults to EPSG:3857. */
  projection?: string;
  minZoom?: number;
  maxZoom?: number;
}

/** Geographic extent [minLon, minLat, maxLon, maxLat] in EPSG:4326. */
export type Extent = [number, number, number, number];

export interface FitOptions {
  /** Uniform pixel padding around the fitted extent. */
  padding?: number;
  /** Cap the zoom level the fit may reach. */
  maxZoom?: number;
}

/** Geometry kinds the draw interaction can produce. */
export type DrawGeometry = 'LineString' | 'Point';

/** Granular OSNAP toggles. `node`+`vertex` both snap to geometry vertices (existing
 * network nodes / pipe endpoints / draft vertices); `edge` snaps to segment interiors
 * (pipe centreline). All-false disables snapping. (`grid` snap is an app-side concern,
 * not a map-engine one, so it is intentionally absent here.) */
export interface SnapModes {
  node: boolean;
  vertex: boolean;
  edge: boolean;
}

/** Draw constraint. `ortho` locks each new segment to the nearest 45° from the
 * previous vertex (AutoCAD-style ORTHO); `null` draws freely. */
export type DrawConstraint = 'ortho' | null;

/** Point-marker shapes a style spec can request. `diamond` = a square rotated 45°. */
export type MarkerShape = 'circle' | 'square' | 'diamond';

/** Image (point/marker) style — PLAIN data, no `ol`. */
export interface ImageSpec {
  shape: MarkerShape;
  radius: number;
  color: string;
  /** Outline color (default white). */
  stroke?: string;
  /** Outline width (default 1). */
  strokeWidth?: number;
}

/** Stroke (line/polygon border) style — PLAIN data, no `ol`. */
export interface StrokeSpec {
  color: string;
  width?: number;
  /** Dash pattern in px, e.g. [6, 4]. */
  dash?: number[];
}

/** A resolved feature style — PLAIN data, the adapter translates it to `ol/style`. */
export interface FeatureStyle {
  stroke?: StrokeSpec;
  fill?: string;
  image?: ImageSpec;
  /** Centered marker label — PLAIN data, no map-engine types. */
  text?: {
    value: string;
    color?: string;
    font?: string;
    offsetY?: number;
    /** Optional outline for labels drawn outside a marker. */
    stroke?: string;
    strokeWidth?: number;
  };
  /** Optional accent halo drawn UNDER the feature (selection / emphasis ring). */
  halo?: StrokeSpec;
  /** 0..1 overall opacity multiplier for this feature. */
  opacity?: number;
}

/**
 * A per-feature style function: receives the feature's GeoJSON properties (plus a
 * `__selected` boolean) and returns a {@link FeatureStyle}, or `undefined`/`null`
 * to fall back to the default style. ZERO `ol` types cross this boundary.
 */
export type StyleSpec = (
  props: Record<string, unknown> & { __selected?: boolean },
) => FeatureStyle | null | undefined;

/** Opt-in scope for one draft feature. Changing the key cancels an in-flight gesture. */
export interface GeometryEditTarget {
  featureId: string;
  mode: 'vertex' | 'segment';
  lockedEndpointIndices: number[];
  gestureKey: string;
}
export interface GeometryEditComplete {
  featureId: string;
  geometry: Geometry;
  gestureKey: string;
}
export interface GeometryVertexSelection { featureId: string; vertexIndex: number }
