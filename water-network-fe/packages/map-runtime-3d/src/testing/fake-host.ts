import type { Coordinate, Extent, FitOptions, Viewport } from '@wn/map-runtime';
import type { Camera3D, CameraOptions, TerrainOptions } from '../port/map-engine-3d-port.js';
import type { HostPointerEvent, MapHost, PickResult } from '../port/map-host.js';

/** Pixels per degree of the fake linear projection (≈ 1.1 m per px). */
export const FAKE_K = 100_000;
export const FAKE_ORIGIN: Coordinate = { lon: 105.8, lat: 21.0 };
export const FAKE_SIZE = { width: 800, height: 600 };

/** A deterministic, WebGL-free MapHost: linear projection + datum-based hit-testing. */
export class FakeHost implements MapHost {
  layers: Array<{ id: string; props: { data?: unknown[]; pickable?: boolean } }> = [];
  view: Viewport = { center: { ...FAKE_ORIGIN }, zoom: 15 };
  camera: Camera3D = { pitch: 0, bearing: 0 };
  basemap: string | null = null;
  buildings = false;
  terrain: TerrainOptions = { enabled: false };
  dragPan = true;
  doubleClickZoom = true;
  cursor: string | null = null;
  mounted = false;
  destroyed = false;
  fitCalls: Array<{ extent: Extent; opts?: FitOptions }> = [];
  elevation: (c: Coordinate) => number | null = () => null;
  #pointer = new Set<(e: HostPointerEvent) => void>();
  #key = new Set<(e: KeyboardEvent) => void>();
  #move = new Set<() => void>();
  #cam = new Set<(c: Camera3D, z: number) => void>();
  #terrain = new Set<() => void>();

  mount(): void {
    this.mounted = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  size() {
    return FAKE_SIZE;
  }
  project(c: Coordinate): [number, number] {
    return [(c.lon - FAKE_ORIGIN.lon) * FAKE_K + FAKE_SIZE.width / 2, (FAKE_ORIGIN.lat - c.lat) * FAKE_K + FAKE_SIZE.height / 2];
  }
  unproject(px: [number, number]): Coordinate {
    return { lon: FAKE_ORIGIN.lon + (px[0] - FAKE_SIZE.width / 2) / FAKE_K, lat: FAKE_ORIGIN.lat - (px[1] - FAKE_SIZE.height / 2) / FAKE_K };
  }
  getView() {
    return this.view;
  }
  setView(v: Viewport) {
    this.view = v;
  }
  fitBounds(extent: Extent, opts?: FitOptions) {
    this.fitCalls.push({ extent, opts });
  }
  getVisibleBbox(): Extent {
    const a = this.unproject([0, FAKE_SIZE.height]);
    const b = this.unproject([FAKE_SIZE.width, 0]);
    return [a.lon, a.lat, b.lon, b.lat];
  }
  getCamera() {
    return this.camera;
  }
  setCamera(c: Partial<Camera3D>, _o?: CameraOptions) {
    this.camera = { ...this.camera, ...c };
    this.#cam.forEach((cb) => cb(this.camera, this.view.zoom));
  }
  onCameraChange(cb: (c: Camera3D, z: number) => void) {
    this.#cam.add(cb);
    return () => this.#cam.delete(cb);
  }
  setBasemap(id: string) {
    this.basemap = id;
  }
  setBuildings(v: boolean) {
    this.buildings = v;
  }
  setTerrain(o: TerrainOptions) {
    this.terrain = o;
  }
  elevationAt(c: Coordinate) {
    return this.elevation(c);
  }
  onTerrainChange(cb: () => void) {
    this.#terrain.add(cb);
    return () => this.#terrain.delete(cb);
  }
  emitTerrainChange() {
    this.#terrain.forEach((cb) => cb());
  }
  setLayers(layers: unknown[]) {
    this.layers = layers as FakeHost['layers'];
  }

  /** Hit-test the deck layers' plain-data datums in screen space. */
  pick(px: [number, number], radius: number): PickResult[] {
    const hits: PickResult[] = [];
    for (const layer of [...this.layers].reverse()) {
      if (!layer.props.pickable) continue;
      for (const d of layer.props.data ?? []) {
        const datum = d as { path?: number[][]; position?: number[]; iconSize?: number; polygon?: number[][][] };
        let dist = Infinity;
        if (datum.path) {
          for (let i = 1; i < datum.path.length; i++) dist = Math.min(dist, segDist(px, this.project(co(datum.path[i - 1]!)), this.project(co(datum.path[i]!))));
        } else if (datum.position) {
          const p = this.project(co(datum.position));
          dist = Math.max(0, Math.hypot(px[0] - p[0], px[1] - p[1]) - (datum.iconSize ?? 0) / 2);
        }
        if (dist <= radius) hits.push({ object: d, layerId: layer.id });
      }
      if (hits.length) break; // topmost layer with a hit wins, like deck
    }
    return hits;
  }

  onPointer(cb: (e: HostPointerEvent) => void) {
    this.#pointer.add(cb);
    return () => this.#pointer.delete(cb);
  }
  onKeyDown(cb: (e: KeyboardEvent) => void) {
    this.#key.add(cb);
    return () => this.#key.delete(cb);
  }
  onMove(cb: () => void) {
    this.#move.add(cb);
    return () => this.#move.delete(cb);
  }
  setDragPan(v: boolean) {
    this.dragPan = v;
  }
  setDoubleClickZoom(v: boolean) {
    this.doubleClickZoom = v;
  }
  setCursor(c: string | null) {
    this.cursor = c;
  }

  // ── test drivers ──
  emit(type: HostPointerEvent['type'], px: [number, number], extra: Partial<HostPointerEvent> = {}) {
    const e: HostPointerEvent = { type, px, coordinate: this.unproject(px), button: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...extra };
    this.#pointer.forEach((cb) => cb(e));
  }
  key(key: string, extra: Partial<KeyboardEventInit> = {}) {
    const e = new KeyboardEvent('keydown', { key, ...extra });
    this.#key.forEach((cb) => cb(e));
  }
  emitMove() {
    this.#move.forEach((cb) => cb());
  }
  /** Pixel of a lon/lat (test convenience). */
  px(lon: number, lat: number): [number, number] {
    return this.project({ lon, lat });
  }
}

const co = (p: number[]): Coordinate => ({ lon: p[0]!, lat: p[1]! });
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
