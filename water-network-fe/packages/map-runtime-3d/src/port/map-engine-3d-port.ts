import type { Coordinate, Extent, FeatureStyle, MapEnginePort } from '@wn/map-runtime';

/** Camera orientation. Pitch 0 = straight down (identical to the 2D engine). */
export interface Camera3D {
  /** Tilt in degrees, 0 (top-down) … {@link MAX_PITCH}. */
  pitch: number;
  /** Compass bearing in degrees, clockwise from north. */
  bearing: number;
}

export interface CameraOptions {
  /** Animate the transition (default true). */
  animate?: boolean;
}

/** The camera used by "3D mode". */
export const MODE_3D_CAMERA: Camera3D = { pitch: 60, bearing: -25 };
export const MODE_2D_CAMERA: Camera3D = { pitch: 0, bearing: 0 };
export const MAX_PITCH = 75;

export interface TerrainOptions {
  enabled: boolean;
  /** Vertical exaggeration (default 1.5). */
  exaggeration?: number;
}

/**
 * Optional 3D extensions of a plain {@link FeatureStyle}. A `StyleSpec` returning
 * this type is still a valid `StyleSpec` for the 2D `MapEnginePort`, so screens
 * written for the 2D engine keep working and may opt into 3D per feature.
 */
export interface FeatureStyle3D extends FeatureStyle {
  /**
   * Draw a LineString as a real-world-size tube (diameter in metres) with flange
   * connectors at the ends and elbow joints at bends. Shown only when the camera is
   * tilted and zoomed in (see `tubeMinZoom`); farther out the normal flat stroke is used.
   */
  tube?: {
    diameterM: number;
    /** Tube colour (defaults to the stroke colour). */
    color?: string;
    /** Connector colour (default slate). */
    fittingColor?: string;
  };
  /**
   * Animate water moving through a LineString. `direction` +1 follows the line's vertex order,
   * -1 runs against it. `speedMps` is the water speed (e.g. derived from pressure): it sets the
   * on-screen speed relative to other pipes, at any zoom. Needs `setFlowAnimation(true)`.
   */
  flow?: {
    speedMps: number;
    direction: 1 | -1;
    /** Particle colour (default light blue). */
    color?: string;
  };
  /** Draw a Point as a small solid (meter box, valve body, hydrant post…), sizes in metres. */
  solid?: {
    shape: 'box' | 'cylinder' | 'sphere';
    /** [width, depth, height] in metres (cylinder: width = diameter). */
    size: [number, number, number];
    color?: string;
  };
  /** Lift the whole feature this many metres above the ground / terrain. */
  elevation?: number;
  /** Extrude a point into a prism (metres) or a polygon into a building-like block. */
  extrude?: {
    /** Height above `elevation`, metres. */
    height: number;
    /** Footprint radius in metres (points only, default 3). */
    radius?: number;
    /** Prism sides: 4 = box, ≥ 12 ≈ cylinder (points only, default 16). */
    sides?: number;
    /** Fill colour of the solid (defaults to the style's image/fill colour). */
    color?: string;
  };
}

/** Right-click: hit feature (null on empty map) + coordinate + pixel — identical to the 2D engine's event. */
export interface ContextMenuEvent {
  featureId: string | null;
  coordinate: Coordinate;
  pixel: [number, number];
}

export type CameraChangeListener = (camera: Camera3D, zoom: number) => void;

/**
 * 3D map engine port. A strict superset of the 2D {@link MapEnginePort}: every
 * 2D method behaves exactly as documented there (zoom uses the same 256-px-tile
 * convention as OpenLayers, selection ids/hit-testing/draw/modify/edit are
 * unchanged), plus camera, buildings and terrain control.
 */
export interface Map3DPort extends MapEnginePort {
  getCamera(): Camera3D;
  setCamera(camera: Partial<Camera3D>, options?: CameraOptions): void;
  /** Convenience: tilt to {@link MODE_3D_CAMERA} (on) or back to top-down north-up (off). */
  set3DMode(enabled: boolean, options?: CameraOptions): void;
  is3DMode(): boolean;
  /** Animate bearing to 0 (keeps pitch). */
  resetNorth(options?: CameraOptions): void;
  /** Subscribe to camera changes (pitch / bearing / zoom). Returns unsubscribe. */
  onCameraChange(cb: CameraChangeListener): () => void;
  /** Extruded OpenStreetMap buildings (OpenFreeMap vector tiles). */
  /** Turn the water-flow animation on/off (pipes whose style has `flow`). */
  setFlowAnimation(enabled: boolean): void;
  getFlowAnimation(): boolean;
  setBuildings(visible: boolean): void;
  getBuildings(): boolean;
  /** Terrain relief; network geometry is draped on it. */
  setTerrain(options: TerrainOptions): void;
  getTerrain(): TerrainOptions;
  /**
   * Geographic bbox [minLon, minLat, maxLon, maxLat] that is actually visible.
   * Unlike a centre/zoom/size estimate this stays correct when the map is tilted.
   */
  getVisibleBbox(): Extent;
}
