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
   * Animate water moving through a LineString: dashes sliding along the flat stroke, and on a 3D
   * tube rings of arrows on its four sides (top, right, bottom, left) moving with the water.
   * `direction` +1 follows the line's vertex order,
   * -1 runs against it. `speedMps` is the water speed (e.g. derived from pressure): it sets the
   * on-screen speed relative to other pipes, at any zoom. Needs `setFlowAnimation(true)`.
   */
  flow?: {
    speedMps: number;
    direction: 1 | -1;
    /** Colour of the flat-map dashes (default light blue). */
    color?: string;
    /** Colour of the arrows that run along the four sides of a 3D tube (default near-white). */
    arrowColor?: string;
  };
  /** Draw a Point as a small solid (meter box, valve body, hydrant post…), sizes in metres. */
  solid?: {
    shape: 'box' | 'cylinder' | 'sphere';
    /** [width, depth, height] in metres (cylinder: width = diameter). */
    size: [number, number, number];
    color?: string;
  };
  /**
   * Draw a Point as a catalog component from `@wn/component-models`: its flat map symbol
   * when the map is flat or zoomed out, and its real 3D model (valve body, hydrant, meter…)
   * when solids are shown. The 3D models load on first use; until then `solid` / `image`
   * are drawn as before, so keep them as the fallback.
   */
  component?: {
    /** Catalog code, e.g. `GateValve`, `Hydrant`, `BulkMeter` (see `@wn/component-models/catalog`). */
    code: string;
    /** Nominal diameter in mm (default: the catalog default for the code). */
    dn?: number;
    /** Body material code: `DuctileIron`, `HDPE`, `PVC`, `Steel`, `CastIron`, `Concrete`. */
    material?: string;
    /** Compass bearing (degrees clockwise from north) of the host pipe, A to B. In-line devices and pipe-aligned symbols turn to it. */
    bearing?: number;
    /** Size multiplier over true size (match the tube boost, e.g. PIPE_3D_SCALE). Default 1. */
    scale?: number;
    /** Live state: colours the model's status part and the symbol's ring. */
    status?: 'normal' | 'warning' | 'critical' | 'offline';
    /** Tint the whole model (e.g. the selection colour). Default: the model's own colours. */
    color?: string;
    /** Draw the catalog symbol instead of `image` in flat mode (default true). */
    symbol?: boolean;
    /** Symbol size in CSS px (default 26). */
    symbolSize?: number;
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
