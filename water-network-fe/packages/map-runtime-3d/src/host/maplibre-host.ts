import * as maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Coordinate, Extent, FitOptions, MapViewOptions, Viewport } from '@wn/map-runtime';
import { MAX_PITCH, type Camera3D, type CameraOptions, type TerrainOptions } from '../port/map-engine-3d-port.js';
import type { HostPointerEvent, MapHost, PickResult } from '../port/map-host.js';
import { basemapStyle, isDarkBasemap, OPENFREEMAP_TILES, TERRAIN_TILES } from '../basemaps/basemaps-3d.js';

/** MapLibre zoom is 512-px-tile based; the port (like OpenLayers) uses 256-px tiles → +1. */
export const ZOOM_OFFSET = 1;

const TERRAIN_SOURCE = 'wn-terrain-dem';
const HILLSHADE_LAYER = 'wn-hillshade';
const OFM_SOURCE = 'wn-ofm';
const BUILDINGS_LAYER = 'wn-buildings-3d';

export interface MapLibreHostOptions extends MapViewOptions {
  pitch?: number;
  bearing?: number;
  basemap?: string;
  /** Show MapLibre's compact attribution control (default true). */
  attribution?: boolean;
  /** Override the MapLibre worker URL (required once under Vite / MapLibre 6). */
  workerUrl?: string;
}

const clampLat = (lat: number): number => Math.max(-85.0511, Math.min(85.0511, lat));

/** The production host: MapLibre GL for basemap / camera / 3D buildings / terrain, deck.gl for every network feature. */
export class MapLibreHost implements MapHost {
  #opts: MapLibreHostOptions;
  #map: maplibregl.Map | null = null;
  #overlay: MapboxOverlay | null = null;
  #container: HTMLElement | null = null;
  #basemap: string;
  #buildings = false;
  #terrain: TerrainOptions = { enabled: false, exaggeration: 1.5 };
  #pendingView: Viewport;
  #pendingCamera: Camera3D;
  #pointerSubs = new Set<(e: HostPointerEvent) => void>();
  #keySubs = new Set<(e: KeyboardEvent) => void>();
  #moveSubs = new Set<() => void>();
  #cameraSubs = new Set<(c: Camera3D, z: number) => void>();
  #terrainSubs = new Set<() => void>();
  #cleanup: Array<() => void> = [];
  #layers: unknown[] = [];
  #downActive = false;
  #lastPx: [number, number] = [0, 0];
  #camRaf = 0;

  constructor(opts: MapLibreHostOptions) {
    this.#opts = opts;
    this.#basemap = opts.basemap ?? 'osm';
    this.#pendingView = { center: { ...opts.center }, zoom: opts.zoom };
    this.#pendingCamera = { pitch: opts.pitch ?? 0, bearing: opts.bearing ?? 0 };
    if (opts.workerUrl) maplibregl.setWorkerUrl(opts.workerUrl);
  }

  mount(target: HTMLElement): void {
    this.#container = target;
    const o = this.#opts;
    const map = new maplibregl.Map({
      container: target,
      style: basemapStyle(this.#basemap) as maplibregl.StyleSpecification | string,
      center: [this.#pendingView.center.lon, clampLat(this.#pendingView.center.lat)],
      zoom: this.#pendingView.zoom - ZOOM_OFFSET,
      pitch: this.#pendingCamera.pitch,
      bearing: this.#pendingCamera.bearing,
      minZoom: o.minZoom !== undefined ? o.minZoom - ZOOM_OFFSET : undefined,
      maxZoom: o.maxZoom !== undefined ? o.maxZoom - ZOOM_OFFSET : 22,
      maxPitch: MAX_PITCH,
      attributionControl: o.attribution === false ? false : { compact: true },
      doubleClickZoom: true,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
    });
    this.#map = map;
    // Dev hook for browser tests that need the raw MapLibre instance.
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (globalThis as { __wnMapLibre?: unknown }).__wnMapLibre = map;
    // MapLibre 6 no longer exposes `map.transform`, which @deck.gl/mapbox reads to place the
    // camera when terrain is on (it throws on every render, so the deck layers freeze while
    // the basemap keeps panning). Provide the two fields it needs.
    if (!(map as unknown as { transform?: unknown }).transform) {
      Object.defineProperty(map, 'transform', {
        configurable: true,
        get: () => ({ elevation: map.getCenterElevation(), height: map.getCanvas().clientHeight }),
      });
    }
    // deck.gl in its own canvas above the map (non-interleaved): works with terrain and every MapLibre 6 style.
    this.#overlay = new MapboxOverlay({ interleaved: false, layers: this.#layers as never[] });
    map.addControl(this.#overlay as unknown as maplibregl.IControl);

    map.on('style.load', () => this.#applyStyleExtras());
    map.on('move', () => {
      this.#moveSubs.forEach((cb) => cb());
      if (this.#camRaf) return;
      this.#camRaf = requestAnimationFrame(() => {
        this.#camRaf = 0;
        const cam = this.getCamera();
        const z = this.getView().zoom;
        this.#cameraSubs.forEach((cb) => cb(cam, z));
      });
    });
    map.on('resize', () => this.#moveSubs.forEach((cb) => cb()));
    map.on('sourcedata', (e) => {
      if ((e as { sourceId?: string }).sourceId === TERRAIN_SOURCE) this.#terrainSubs.forEach((cb) => cb());
    });

    const emit = (type: HostPointerEvent['type'], e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const oe = e.originalEvent as MouseEvent & { touches?: unknown };
      const px: [number, number] = [e.point.x, e.point.y];
      this.#lastPx = px;
      const evt: HostPointerEvent = {
        type,
        px,
        coordinate: { lon: e.lngLat.lng, lat: e.lngLat.lat },
        button: typeof oe.button === 'number' ? oe.button : 0,
        altKey: !!oe.altKey,
        shiftKey: !!oe.shiftKey,
        ctrlKey: !!oe.ctrlKey,
        metaKey: !!oe.metaKey,
      };
      this.#pointerSubs.forEach((cb) => cb(evt));
    };
    map.on('mousedown', (e) => {
      this.#downActive = true;
      emit('down', e);
    });
    map.on('touchstart', (e) => {
      this.#downActive = true;
      emit('down', e);
    });
    const up = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      this.#downActive = false;
      emit('up', e);
    };
    map.on('mouseup', up);
    map.on('touchend', (e) => up(e));
    map.on('mousemove', (e) => emit('move', e));
    map.on('touchmove', (e) => emit('move', e));
    map.on('click', (e) => emit('click', e));
    map.on('dblclick', (e) => emit('dblclick', e));
    map.on('contextmenu', (e) => {
      e.originalEvent.preventDefault();
      emit('contextmenu', e);
    });
    const onLeave = () => {
      const c = this.unproject(this.#lastPx);
      this.#pointerSubs.forEach((cb) => cb({ type: 'leave', px: this.#lastPx, coordinate: c, button: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }));
    };
    target.addEventListener('mouseleave', onLeave);
    // A drag released outside the canvas must still end the gesture.
    const winUp = (ev: MouseEvent) => {
      if (!this.#downActive) return;
      this.#downActive = false;
      const r = target.getBoundingClientRect();
      const px: [number, number] = [ev.clientX - r.left, ev.clientY - r.top];
      this.#pointerSubs.forEach((cb) => cb({ type: 'up', px, coordinate: this.unproject(px), button: ev.button, altKey: ev.altKey, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey }));
    };
    window.addEventListener('mouseup', winUp);
    const onKey = (ev: KeyboardEvent) => this.#keySubs.forEach((cb) => cb(ev));
    target.ownerDocument.addEventListener('keydown', onKey);
    this.#cleanup.push(
      () => target.removeEventListener('mouseleave', onLeave),
      () => window.removeEventListener('mouseup', winUp),
      () => target.ownerDocument.removeEventListener('keydown', onKey),
    );
  }

  destroy(): void {
    if (this.#camRaf) cancelAnimationFrame(this.#camRaf);
    for (const c of this.#cleanup) c();
    this.#cleanup = [];
    if (this.#map) {
      if (this.#overlay) this.#map.removeControl(this.#overlay as unknown as maplibregl.IControl);
      this.#overlay?.finalize();
      this.#map.remove();
    }
    this.#map = null;
    this.#overlay = null;
    for (const s of [this.#pointerSubs, this.#keySubs, this.#moveSubs, this.#cameraSubs, this.#terrainSubs] as Array<Set<unknown>>) s.clear();
  }

  size() {
    const c = this.#container;
    return { width: c?.clientWidth ?? 0, height: c?.clientHeight ?? 0 };
  }

  project(c: Coordinate): [number, number] {
    const p = this.#map!.project([c.lon, clampLat(c.lat)]);
    return [p.x, p.y];
  }
  unproject(px: [number, number]): Coordinate {
    const l = this.#map!.unproject(px);
    return { lon: l.lng, lat: l.lat };
  }

  getView(): Viewport {
    if (!this.#map) return this.#pendingView;
    const c = this.#map.getCenter();
    return { center: { lon: c.lng, lat: c.lat }, zoom: this.#map.getZoom() + ZOOM_OFFSET };
  }
  setView(v: Viewport): void {
    this.#pendingView = v;
    this.#map?.jumpTo({ center: [v.center.lon, clampLat(v.center.lat)], zoom: v.zoom - ZOOM_OFFSET });
  }
  fitBounds(extent: Extent, opts: FitOptions = {}): void {
    const map = this.#map;
    if (!map) return;
    // A container that is not laid out yet (or smaller than the padding) makes MapLibre compute a
    // NaN camera and throw; skip it / shrink the padding instead of crashing the caller.
    const el = map.getContainer();
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w < 2 || h < 2) return;
    const pad = Math.max(0, Math.min(opts.padding ?? 32, Math.floor((Math.min(w, h) - 2) / 2)));
    const bounds: [[number, number], [number, number]] = [
      [extent[0], extent[1]],
      [extent[2], extent[3]],
    ];
    const options = { padding: pad, maxZoom: opts.maxZoom !== undefined ? opts.maxZoom - ZOOM_OFFSET : undefined, duration: 0, bearing: map.getBearing(), pitch: map.getPitch() };
    try {
      if (!map.cameraForBounds(bounds, options)) return;
      map.fitBounds(bounds, options);
    } catch {
      /* degenerate camera (e.g. mid-resize): keep the current view */
    }
  }
  getVisibleBbox(): Extent {
    const b = this.#map!.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  getCamera(): Camera3D {
    if (!this.#map) return this.#pendingCamera;
    return { pitch: this.#map.getPitch(), bearing: this.#map.getBearing() };
  }
  setCamera(camera: Partial<Camera3D>, opts: CameraOptions = {}): void {
    this.#pendingCamera = { ...this.#pendingCamera, ...camera };
    const map = this.#map;
    if (!map) return;
    const target = { ...camera, ...(camera.pitch !== undefined ? { pitch: Math.max(0, Math.min(MAX_PITCH, camera.pitch)) } : {}) };
    if (opts.animate === false) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 800 });
  }
  onCameraChange(cb: (c: Camera3D, z: number) => void) {
    this.#cameraSubs.add(cb);
    return () => this.#cameraSubs.delete(cb);
  }

  setBasemap(id: string): void {
    if (id === this.#basemap && this.#map) return;
    this.#basemap = id;
    // setStyle drops our sources/layers; #applyStyleExtras re-adds buildings + terrain on style.load.
    this.#map?.setStyle(basemapStyle(id) as maplibregl.StyleSpecification | string, { diff: false });
  }

  setBuildings(visible: boolean): void {
    this.#buildings = visible;
    this.#applyBuildings();
  }

  setTerrain(opts: TerrainOptions): void {
    this.#terrain = { enabled: opts.enabled, exaggeration: opts.exaggeration ?? this.#terrain.exaggeration ?? 1.5 };
    this.#applyTerrain();
  }

  elevationAt(c: Coordinate): number | null {
    if (!this.#map || !this.#terrain.enabled) return null;
    try {
      const v = this.#map.queryTerrainElevation([c.lon, clampLat(c.lat)]);
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }
  onTerrainChange(cb: () => void) {
    this.#terrainSubs.add(cb);
    return () => this.#terrainSubs.delete(cb);
  }

  setLayers(layers: unknown[]): void {
    this.#layers = layers;
    this.#overlay?.setProps({ layers: layers as never[] });
  }

  pick(px: [number, number], radius: number): PickResult[] {
    if (!this.#overlay) return [];
    const infos = this.#overlay.pickMultipleObjects({ x: px[0], y: px[1], radius, depth: 8 });
    return infos.filter((i) => i.object && i.layer).map((i) => ({ object: i.object, layerId: i.layer!.id }));
  }

  onPointer(cb: (e: HostPointerEvent) => void) {
    this.#pointerSubs.add(cb);
    return () => this.#pointerSubs.delete(cb);
  }
  onKeyDown(cb: (e: KeyboardEvent) => void) {
    this.#keySubs.add(cb);
    return () => this.#keySubs.delete(cb);
  }
  onMove(cb: () => void) {
    this.#moveSubs.add(cb);
    return () => this.#moveSubs.delete(cb);
  }

  setDragPan(enabled: boolean): void {
    if (!this.#map) return;
    if (enabled) this.#map.dragPan.enable();
    else this.#map.dragPan.disable();
  }
  setDoubleClickZoom(enabled: boolean): void {
    if (!this.#map) return;
    if (enabled) this.#map.doubleClickZoom.enable();
    else this.#map.doubleClickZoom.disable();
  }
  setCursor(cursor: string | null): void {
    if (this.#map) this.#map.getCanvas().style.cursor = cursor ?? '';
  }

  // ───────── style extras (re-applied after every style swap) ─────────

  #applyStyleExtras(): void {
    this.#applyTerrain();
    this.#applyBuildings();
  }

  #hasStyle(): boolean {
    return !!this.#map && this.#map.isStyleLoaded() !== undefined && !!this.#map.getStyle();
  }

  #applyBuildings(): void {
    const map = this.#map;
    if (!map || !this.#hasStyle()) return;
    try {
      // Vector styles (Liberty) already ship extrusion layers: just toggle them.
      const styleLayers = map.getStyle().layers ?? [];
      const native = styleLayers.filter((l) => l.type === 'fill-extrusion' && l.id !== BUILDINGS_LAYER);
      if (native.length) {
        for (const l of native) map.setLayoutProperty(l.id, 'visibility', this.#buildings ? 'visible' : 'none');
        return;
      }
      if (!this.#buildings) {
        if (map.getLayer(BUILDINGS_LAYER)) map.setLayoutProperty(BUILDINGS_LAYER, 'visibility', 'none');
        return;
      }
      if (!map.getSource(OFM_SOURCE)) map.addSource(OFM_SOURCE, { type: 'vector', url: OPENFREEMAP_TILES, attribution: '© OpenStreetMap contributors, OpenFreeMap' } as never);
      if (!map.getLayer(BUILDINGS_LAYER)) {
        const dark = isDarkBasemap(this.#basemap);
        map.addLayer({
          id: BUILDINGS_LAYER,
          type: 'fill-extrusion',
          source: OFM_SOURCE,
          'source-layer': 'building',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': dark ? '#4a5568' : '#d9d5cc',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6] as never,
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] as never,
            'fill-extrusion-opacity': 0.82,
          },
        });
      } else {
        map.setLayoutProperty(BUILDINGS_LAYER, 'visibility', 'visible');
      }
    } catch {
      /* style not ready yet — style.load re-applies */
    }
  }

  #applyTerrain(): void {
    const map = this.#map;
    if (!map || !this.#hasStyle()) return;
    try {
      if (!this.#terrain.enabled) {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getLayer(HILLSHADE_LAYER)) map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', 'none');
        return;
      }
      if (!map.getSource(TERRAIN_SOURCE)) {
        map.addSource(TERRAIN_SOURCE, { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen / AWS Terrain Tiles' });
      }
      if (!map.getLayer(HILLSHADE_LAYER)) {
        map.addLayer({ id: HILLSHADE_LAYER, type: 'hillshade', source: TERRAIN_SOURCE, paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3b4252' } });
      } else {
        map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', 'visible');
      }
      map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: this.#terrain.exaggeration ?? 1.5 });
    } catch {
      /* style not ready yet — style.load re-applies */
    }
  }
}
