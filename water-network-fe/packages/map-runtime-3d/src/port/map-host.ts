import type { Coordinate, Extent, FitOptions, Viewport } from '@wn/map-runtime';
import type { Camera3D, CameraOptions, TerrainOptions } from './map-engine-3d-port.js';

/** A pointer event normalised by the host (CSS pixels relative to the map container). */
export interface HostPointerEvent {
  type: 'down' | 'move' | 'up' | 'click' | 'dblclick' | 'contextmenu' | 'leave';
  px: [number, number];
  coordinate: Coordinate;
  button: number;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface PickResult {
  /** The deck datum that was hit. */
  object: unknown;
  /** The deck layer id that produced it. */
  layerId: string;
}

/**
 * Everything the engine needs from the rendering back end. The production host
 * wraps MapLibre GL + deck.gl; tests inject a deterministic fake so the engine
 * (feature store, styling, draw / modify / geometry-edit, hit-testing) is covered
 * without WebGL. ZERO MapLibre/deck types cross this boundary.
 */
export interface MapHost {
  mount(target: HTMLElement): void;
  destroy(): void;
  size(): { width: number; height: number };

  /** lon/lat → CSS pixel. */
  project(c: Coordinate): [number, number];
  /** CSS pixel → lon/lat on the ground plane. */
  unproject(px: [number, number]): Coordinate;

  getView(): Viewport;
  setView(v: Viewport): void;
  fitBounds(extent: Extent, opts?: FitOptions): void;
  getVisibleBbox(): Extent;

  getCamera(): Camera3D;
  setCamera(camera: Partial<Camera3D>, opts?: CameraOptions): void;
  onCameraChange(cb: (camera: Camera3D, zoom: number) => void): () => void;

  setBasemap(id: string): void;
  setBuildings(visible: boolean): void;
  setTerrain(opts: TerrainOptions): void;
  /** Elevation (metres, already exaggerated) at a coordinate, or null when unknown. */
  elevationAt(c: Coordinate): number | null;
  /** Called when terrain tiles (re)load so the engine can re-drape geometry. */
  onTerrainChange(cb: () => void): () => void;

  /** Replace the deck.gl layer list. */
  setLayers(layers: unknown[]): void;
  /** Deck objects within `radius` px of `px`, topmost first. */
  pick(px: [number, number], radius: number): PickResult[];

  onPointer(cb: (e: HostPointerEvent) => void): () => void;
  onKeyDown(cb: (e: KeyboardEvent) => void): () => void;
  /** Called after any map move so screen-space overlays (handles, snap markers) can refresh. */
  onMove(cb: () => void): () => void;

  setDragPan(enabled: boolean): void;
  setDoubleClickZoom(enabled: boolean): void;
  setCursor(cursor: string | null): void;
}
