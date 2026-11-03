import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryEditTarget, GeometryEditComplete, GeometryVertexSelection, ContextMenuEvent, Coordinate, DrawConstraint, DrawGeometry, Extent, FitOptions, SnapModes, StyleSpec, Viewport } from './types.js';

/**
 * Anti-corruption boundary for the map engine. ZERO `ol` types cross this
 * interface — only `packages/map-runtime/src/openlayers/*` imports `ol`. Each MFE
 * creates its own instance via the factory; a live map is never shared across apps.
 */
export interface MapEnginePort {
  mount(target: HTMLElement): void;
  setView(view: Viewport): void;
  getView(): Viewport;
  /** Render a vector layer (e.g. 'published') from a GeoJSON FeatureCollection (EPSG:4326).
   * An optional plain {@link StyleSpec} styles every feature from its properties;
   * omit it to use the built-in kind-based style. */
  setFeatures(layerId: string, features: FeatureCollection, style?: StyleSpec): void;
  /** Restyle an existing layer in place (no feature re-add) — e.g. for emphasis/paint changes. */
  setLayerStyle(layerId: string, style: StyleSpec): void;
  /** Highlight a feature by id (null clears). */
  setSelection(featureId: string | null): void;
  getSelection(): string | null;
  /** Subscribe to feature clicks; returns an unsubscribe fn. */
  onFeatureClick(cb: (featureId: string) => void): () => void;
  /** Subscribe to pointer moves (lon/lat); cb receives null when the pointer leaves the map. Returns unsubscribe. */
  onPointerMove(cb: (coordinate: Coordinate | null) => void): () => void;
  /** Toggle a vector layer's visibility. */
  setLayerVisible(layerId: string, visible: boolean): void;
  /** Switch the basemap by id (see BASEMAPS catalog). */
  setBasemap(basemapId: string): void;
  /** Fit the view to a geographic extent (EPSG:4326). */
  fitToBbox(extent: Extent, opts?: FitOptions): void;
  /** Enter draw mode for a geometry kind (null exits). The ol Draw interaction lives only in the adapter. */
  setDrawMode(geometry: DrawGeometry | null): void;
  /** Subscribe to completed draws; cb receives the geometry as GeoJSON (EPSG:4326). Returns unsubscribe. */
  onDrawComplete(cb: (geometry: Geometry) => void): () => void;
  /** Enable/disable vertex modify on the 'draft' layer. Snap (draft + published) follows automatically. */
  setModifyMode(enabled: boolean): void;
  /** Subscribe to completed modifications; cb receives (featureId, geometry as GeoJSON EPSG:4326). Returns unsubscribe. */
  onModifyComplete(cb: (featureId: string, geometry: Geometry) => void): () => void;
  /** Edit one draft feature. Null cancels preview and clears vertex selection. Exclusive with Draw/legacy Modify. */
  setGeometryEditTarget(target: GeometryEditTarget | null): void;
  onGeometryEditComplete(cb: (event: GeometryEditComplete) => void): () => void;
  onGeometryVertexSelect(cb: (selection: GeometryVertexSelection | null) => void): () => void;
  deleteSelectedGeometryVertex(): void;
  /** Chuột phải: hit-test tại pixel; cb nhận feature (null nếu trống) + toạ độ lon/lat + pixel. Trả unsubscribe. */
  onContextMenu(cb: (event: ContextMenuEvent) => void): () => void;
  /** Enter/exit "pick a point on a feature" mode: a click hit-tests the draft layer and reports the click projected onto that feature's geometry. */
  setFeaturePointMode(enabled: boolean): void;
  /** Subscribe to feature-point picks; cb receives (featureId, point lon/lat on the feature). Returns unsubscribe. */
  onFeaturePointPick(cb: (featureId: string, point: Coordinate) => void): () => void;
  /** Enter/exit box-select (rubber-band) mode: a drag draws a rectangle and reports every
   * feature (across all vector layers) intersecting it. The ol DragBox interaction lives only in the adapter. */
  setBoxSelectMode(enabled: boolean): void;
  /** Subscribe to box-select completions; cb receives the intersecting feature ids. Returns unsubscribe. */
  onBoxSelect(cb: (featureIds: string[]) => void): () => void;
  /** Configure which OSNAP targets active draw/modify snaps to (vertices vs edges). */
  setSnapModes(modes: SnapModes): void;
  /** Constrain drawing (e.g. `'ortho'` locks segments to 45°); `null` draws freely. Applies to the next/active draw. */
  setDrawConstraint(constraint: DrawConstraint): void;
  /** Show a live length readout on the sketch while drawing a line (real ground metres via ol/sphere). */
  setDrawMeasure(enabled: boolean): void;
  destroy(): void;
}
