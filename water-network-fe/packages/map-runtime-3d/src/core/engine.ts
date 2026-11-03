import type { FeatureCollection, Geometry } from 'geojson';
import type {
  Coordinate,
  DrawConstraint,
  DrawGeometry,
  Extent,
  FitOptions,
  GeometryEditComplete,
  GeometryEditTarget,
  GeometryVertexSelection,
  SnapModes,
  StyleSpec,
  Viewport,
} from '@wn/map-runtime';
import { toGeoPoint, toMapPoint } from '@wn/map-runtime';
import type { ContextMenuEvent } from '../port/map-engine-3d-port.js';
import { IconAtlas } from '../layers/icon-atlas.js';
import { buildFlowDashLayer, buildFlowLayer, buildDeckLayers, type LayerEntry } from '../layers/build-deck-layers.js';
import { computeDashes, computeParticles, type FlowDatum } from '../layers/flow.js';
import type { Layer } from '@deck.gl/core';
import { MODE_2D_CAMERA, MODE_3D_CAMERA, type Camera3D, type CameraChangeListener, type CameraOptions, type Map3DPort, type TerrainOptions } from '../port/map-engine-3d-port.js';
import type { HostPointerEvent, MapHost, PickResult } from '../port/map-host.js';
import { createGeometryEditController, type GeometryEditController } from './interactions/geometry-edit.js';
import { createBoxSelectInteraction } from './interactions/box-select.js';
import { createDrawInteraction } from './interactions/draw.js';
import { createModifyInteraction } from './interactions/modify.js';
import type { Interaction, InteractionContext } from './interaction.js';
import { closestOnSegment, type Px } from './geo-math.js';
import { geometryLines, geometryPoints, LayerStore } from './layer-store.js';

export interface EngineConfig {
  /** Delay before a click is reported as a feature click (lets a double-click win). 0 = immediate. */
  clickDelayMs?: number;
  /** Hit-test radius in CSS px. */
  pickRadiusPx?: number;
  /** OpenLayers-convention zoom from which tilted views draw tubes/solids instead of flat strokes (default 17.5). */
  solidsMinZoom?: number;
}

const FLOW_PX_PER_SEC_PER_MPS = 12;
const FLOW_SPACING_PX = 30;
const FLOW_MAX_PARTICLES = 40_000;
const FLOW_DASH_PERIOD_PX = 18;
const FLOW_DASH_PX = 9;
const FLOW_MAX_DASH_SEGMENTS = 60_000;

const LAYER_PREFIX = 'L/';
const OVERLAY_PREFIX = 'overlay/';

export class MapEngine3D implements Map3DPort {
  readonly #host: MapHost;
  readonly #store = new LayerStore();
  readonly #atlas = new IconAtlas();
  readonly #cfg: Required<EngineConfig>;
  #mounted = false;
  #destroyed = false;
  #selected: string | null = null;

  // subscriptions
  #clickSubs = new Set<(id: string) => void>();
  #pointerSubs = new Set<(c: Coordinate | null) => void>();
  #drawSubs = new Set<(g: Geometry) => void>();
  #modifySubs = new Set<(id: string, g: Geometry) => void>();
  #geometrySubs = new Set<(e: GeometryEditComplete) => void>();
  #vertexSubs = new Set<(s: GeometryVertexSelection | null) => void>();
  #pointPickSubs = new Set<(id: string, c: Coordinate) => void>();
  #boxSubs = new Set<(ids: string[]) => void>();
  #ctxSubs = new Set<(e: ContextMenuEvent) => void>();
  #cameraSubs = new Set<CameraChangeListener>();

  // mode state (kept so it survives until mount)
  #drawGeometry: DrawGeometry | null = null;
  #drawConstraint: DrawConstraint = null;
  #drawMeasure = false;
  #modifyEnabled = false;
  #boxEnabled = false;
  #featurePointMode = false;
  #snapModes: SnapModes = { node: true, vertex: true, edge: true };
  #geometryTarget: GeometryEditTarget | null = null;

  // live interactions
  #draw: Interaction | null = null;
  #modify: Interaction | null = null;
  #box: Interaction | null = null;
  #geometry: GeometryEditController | null = null;

  // 3D state
  #buildings = false;
  #terrain: TerrainOptions = { enabled: false, exaggeration: 1.5 };
  #terrainRevision = 0;
  #terrainTimer: ReturnType<typeof setTimeout> | null = null;

  // event plumbing
  #unsubs: Array<() => void> = [];
  #suppressClick = false;
  #clickTimer: ReturnType<typeof setTimeout> | null = null;
  #renderQueued = false;
  #solids = false;
  // water-flow animation
  #flowEnabled = true;
  #flows: FlowDatum[] = [];
  #staticLayers: Layer[] = [];
  #flowRaf = 0;
  #flowLast = 0;
  #flowStart = 0;
  #lastPointer: HostPointerEvent | null = null;

  constructor(host: MapHost, config: EngineConfig = {}) {
    this.#host = host;
    this.#cfg = { clickDelayMs: config.clickDelayMs ?? 250, pickRadiusPx: config.pickRadiusPx ?? 4, solidsMinZoom: config.solidsMinZoom ?? 17.5 };
  }

  get #ctx(): InteractionContext {
    return {
      host: this.#host,
      store: this.#store,
      atlas: this.#atlas,
      snapModes: () => this.#snapModes,
      requestRender: () => this.#requestRender(),
      suppressClick: () => {
        this.#suppressClick = true;
      },
    };
  }

  // ───────────────────────── lifecycle ─────────────────────────

  mount(target: HTMLElement): void {
    this.#host.mount(target);
    this.#mounted = true;
    this.#unsubs.push(
      this.#host.onPointer((e) => this.#onPointer(e)),
      this.#host.onKeyDown((e) => this.#onKey(e)),
      this.#host.onMove(() => {
        for (const i of this.#interactionList()) i.onMove?.();
      }),
      this.#host.onCameraChange((cam, zoom) => {
        this.#cameraSubs.forEach((cb) => cb(cam, zoom));
        if (this.#solidsActive(cam.pitch, zoom) !== this.#solids) this.#requestRender();
      }),
      this.#host.onTerrainChange(() => {
        if (!this.#terrain.enabled || this.#terrainTimer) return;
        this.#terrainTimer = setTimeout(() => {
          this.#terrainTimer = null;
          this.#terrainRevision++;
          this.#requestRender();
        }, 250);
      }),
    );
    this.#applyModes();
    this.#syncGeometryController();
    this.#requestRender();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#clearGeometryController();
    this.#geometryTarget = null;
    for (const i of [this.#draw, this.#modify, this.#box]) i?.destroy();
    this.#draw = this.#modify = this.#box = null;
    if (this.#clickTimer) clearTimeout(this.#clickTimer);
    if (this.#terrainTimer) clearTimeout(this.#terrainTimer);
    if (this.#flowRaf) this.#caf(this.#flowRaf);
    this.#flowRaf = 0;
    for (const u of this.#unsubs) u();
    this.#unsubs = [];
    this.#host.destroy();
    this.#store.clear();
    for (const set of [this.#clickSubs, this.#pointerSubs, this.#drawSubs, this.#modifySubs, this.#geometrySubs, this.#vertexSubs, this.#pointPickSubs, this.#boxSubs, this.#ctxSubs, this.#cameraSubs] as Array<Set<unknown>>) set.clear();
    this.#mounted = false;
    this.#featurePointMode = false;
    this.#drawMeasure = false;
  }

  // ───────────────────────── view ─────────────────────────

  setView(v: Viewport): void {
    this.#host.setView(v);
  }
  getView(): Viewport {
    return this.#host.getView();
  }
  fitToBbox(extent: Extent, opts?: FitOptions): void {
    if (!this.#mounted) return;
    // Garbage extents (NaN from an unprojected legacy plane) would throw inside MapLibre.
    if (!extent.every(Number.isFinite)) return;
    this.#host.fitBounds(extent, opts);
  }
  getVisibleBbox(): Extent {
    return this.#host.getVisibleBbox();
  }
  setBasemap(basemapId: string): void {
    this.#host.setBasemap(basemapId);
  }

  // ───────────────────────── 3D ─────────────────────────

  getCamera(): Camera3D {
    return this.#host.getCamera();
  }
  setCamera(camera: Partial<Camera3D>, options?: CameraOptions): void {
    this.#host.setCamera(camera, options);
  }
  set3DMode(enabled: boolean, options?: CameraOptions): void {
    this.#host.setCamera(enabled ? MODE_3D_CAMERA : MODE_2D_CAMERA, options);
  }
  is3DMode(): boolean {
    return this.#host.getCamera().pitch > 1;
  }
  resetNorth(options?: CameraOptions): void {
    this.#host.setCamera({ bearing: 0 }, options);
  }
  onCameraChange(cb: CameraChangeListener): () => void {
    this.#cameraSubs.add(cb);
    return () => this.#cameraSubs.delete(cb);
  }
  setBuildings(visible: boolean): void {
    this.#buildings = visible;
    this.#host.setBuildings(visible);
  }
  getBuildings(): boolean {
    return this.#buildings;
  }
  setTerrain(options: TerrainOptions): void {
    this.#terrain = { enabled: options.enabled, exaggeration: options.exaggeration ?? this.#terrain.exaggeration ?? 1.5 };
    this.#host.setTerrain(this.#terrain);
    this.#terrainRevision++;
    this.#requestRender();
  }
  getTerrain(): TerrainOptions {
    return { ...this.#terrain };
  }

  // ───────────────────────── features ─────────────────────────

  setFeatures(layerId: string, features: FeatureCollection, style?: StyleSpec): void {
    const draft = layerId === 'draft';
    const targetId = draft ? this.#geometryTarget?.featureId : undefined;
    const previous = targetId ? this.#store.getFeature(layerId, targetId)?.feature.geometry : undefined;
    const next = targetId ? features.features.find((f) => String(f.id) === targetId)?.geometry : undefined;
    // Retain the live target and its preview when only properties / other assets rerender.
    const preserveTarget = !!(this.#geometry && previous && next && JSON.stringify(previous) === JSON.stringify(next));
    if (draft && !preserveTarget) {
      this.#clearGeometryController();
      this.#store.clearPreviews(layerId);
    }
    this.#store.set(layerId, features, style);
    this.#syncGeometryController();
    this.#requestRender();
  }

  setLayerStyle(layerId: string, style: StyleSpec): void {
    this.#store.setStyle(layerId, style);
    this.#requestRender();
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.#store.setVisible(layerId, visible);
    this.#requestRender();
  }

  setSelection(featureId: string | null): void {
    if (this.#geometryTarget && featureId !== this.#geometryTarget.featureId) this.setGeometryEditTarget(null);
    this.#selected = featureId;
    this.#requestRender();
  }
  getSelection(): string | null {
    return this.#selected;
  }

  // ───────────────────────── subscriptions ─────────────────────────

  onFeatureClick(cb: (id: string) => void): () => void {
    this.#clickSubs.add(cb);
    return () => this.#clickSubs.delete(cb);
  }
  onPointerMove(cb: (c: Coordinate | null) => void): () => void {
    this.#pointerSubs.add(cb);
    return () => this.#pointerSubs.delete(cb);
  }
  onDrawComplete(cb: (g: Geometry) => void): () => void {
    this.#drawSubs.add(cb);
    return () => this.#drawSubs.delete(cb);
  }
  onModifyComplete(cb: (id: string, g: Geometry) => void): () => void {
    this.#modifySubs.add(cb);
    return () => this.#modifySubs.delete(cb);
  }
  onGeometryEditComplete(cb: (e: GeometryEditComplete) => void): () => void {
    this.#geometrySubs.add(cb);
    return () => this.#geometrySubs.delete(cb);
  }
  onGeometryVertexSelect(cb: (s: GeometryVertexSelection | null) => void): () => void {
    this.#vertexSubs.add(cb);
    return () => this.#vertexSubs.delete(cb);
  }
  onFeaturePointPick(cb: (id: string, c: Coordinate) => void): () => void {
    this.#pointPickSubs.add(cb);
    return () => this.#pointPickSubs.delete(cb);
  }
  onBoxSelect(cb: (ids: string[]) => void): () => void {
    this.#boxSubs.add(cb);
    return () => this.#boxSubs.delete(cb);
  }
  onContextMenu(cb: (e: ContextMenuEvent) => void): () => void {
    this.#ctxSubs.add(cb);
    return () => this.#ctxSubs.delete(cb);
  }

  // ───────────────────────── editing modes ─────────────────────────

  setDrawMode(geometry: DrawGeometry | null): void {
    if (geometry) {
      this.setGeometryEditTarget(null);
      this.setModifyMode(false);
    }
    this.#drawGeometry = geometry;
    this.#applyDraw();
  }
  setDrawConstraint(constraint: DrawConstraint): void {
    this.#drawConstraint = constraint;
    this.#requestRender();
  }
  setDrawMeasure(enabled: boolean): void {
    this.#drawMeasure = enabled;
    this.#requestRender();
  }
  setSnapModes(modes: SnapModes): void {
    this.#snapModes = modes;
  }
  setModifyMode(enabled: boolean): void {
    if (enabled) {
      this.setGeometryEditTarget(null);
      this.setDrawMode(null);
    }
    this.#modifyEnabled = enabled;
    this.#applyModify();
  }
  setFeaturePointMode(enabled: boolean): void {
    if (enabled) this.setGeometryEditTarget(null);
    this.#featurePointMode = enabled;
    this.#host.setCursor(enabled && this.#mounted ? 'crosshair' : null);
  }
  setBoxSelectMode(enabled: boolean): void {
    if (enabled) this.setGeometryEditTarget(null);
    this.#boxEnabled = enabled;
    this.#applyBox();
  }
  setGeometryEditTarget(target: GeometryEditTarget | null): void {
    if (JSON.stringify(target) === JSON.stringify(this.#geometryTarget)) {
      this.#syncGeometryController();
      return;
    }
    this.#clearGeometryController();
    this.#geometryTarget = target ? { ...target, lockedEndpointIndices: [...target.lockedEndpointIndices] } : null;
    if (target) {
      this.setDrawMode(null);
      this.setModifyMode(false);
    }
    this.#syncGeometryController();
  }
  deleteSelectedGeometryVertex(): void {
    this.#geometry?.deleteSelectedVertex();
  }

  // ───────────────────────── interaction wiring ─────────────────────────

  #applyModes(): void {
    this.#applyDraw();
    this.#applyModify();
    this.#applyBox();
  }

  #applyDraw(): void {
    this.#draw?.destroy();
    this.#draw = null;
    if (this.#drawGeometry && this.#mounted) {
      this.#draw = createDrawInteraction(
        this.#ctx,
        { geometry: this.#drawGeometry, constraint: this.#drawConstraint, measure: this.#drawMeasure, onComplete: (g) => this.#drawSubs.forEach((cb) => cb(g)) },
        () => this.#drawConstraint,
        () => this.#drawMeasure,
      );
    }
    this.#requestRender();
  }

  #applyModify(): void {
    this.#modify?.destroy();
    this.#modify = null;
    if (this.#modifyEnabled && this.#mounted) {
      this.#modify = createModifyInteraction(this.#ctx, (id, g) => this.#modifySubs.forEach((cb) => cb(id, g)));
    }
    this.#requestRender();
  }

  #applyBox(): void {
    this.#box?.destroy();
    this.#box = null;
    if (this.#boxEnabled && this.#mounted) {
      this.#box = createBoxSelectInteraction(this.#ctx, (ids) => this.#boxSubs.forEach((cb) => cb(ids)));
    }
    this.#requestRender();
  }

  #clearGeometryController(): void {
    if (!this.#geometry) return;
    this.#geometry.destroy();
    this.#geometry = null;
    this.#vertexSubs.forEach((cb) => cb(null));
  }

  #syncGeometryController(): void {
    if (this.#geometry || !this.#mounted || !this.#geometryTarget) return;
    if (!this.#store.getFeature('draft', this.#geometryTarget.featureId)) return; // wait until supplied
    this.#geometry = createGeometryEditController(this.#ctx, {
      target: this.#geometryTarget,
      onComplete: (e) => this.#geometrySubs.forEach((cb) => cb(e)),
      onVertexSelect: (s) => this.#vertexSubs.forEach((cb) => cb(s)),
    });
  }

  /** Newest interaction first — later-added interactions get first refusal, like OpenLayers. */
  #interactionList(): Interaction[] {
    return [this.#geometry, this.#box, this.#modify, this.#draw].filter((i): i is Interaction => !!i);
  }

  #onKey(e: KeyboardEvent): void {
    for (const i of this.#interactionList()) if (i.onKey?.(e)) return;
  }

  // ───────────────────────── pointer handling ─────────────────────────

  #featureHits(px: Px, radius = this.#cfg.pickRadiusPx): Array<{ id: string; layerId: string }> {
    const out: Array<{ id: string; layerId: string }> = [];
    for (const r of this.#host.pick(px, radius)) {
      const layerId = this.#layerOf(r);
      const fid = (r.object as { fid?: string } | null)?.fid;
      if (layerId && fid) out.push({ id: fid, layerId });
    }
    return out;
  }

  #layerOf(r: PickResult): string | null {
    if (!r.layerId.startsWith(LAYER_PREFIX)) return null;
    let best: string | null = null;
    for (const id of this.#store.layerIds()) {
      if (r.layerId.startsWith(`${LAYER_PREFIX}${id}:`) && (!best || id.length > best.length)) best = id;
    }
    return best;
  }

  #onPointer(e: HostPointerEvent): void {
    this.#lastPointer = e;
    // 1) interactions (newest first)
    if (e.type === 'down') this.#suppressClick = false;
    let consumed = false;
    for (const i of this.#interactionList()) {
      if (i.onPointer?.(e)) {
        consumed = true;
        break;
      }
    }
    if (consumed && e.type === 'down') this.#suppressClick = true;

    // 2) engine-level behaviour (always runs, like OL map listeners)
    switch (e.type) {
      case 'move':
        this.#pointerSubs.forEach((cb) => cb(e.coordinate));
        break;
      case 'leave':
        this.#pointerSubs.forEach((cb) => cb(null));
        break;
      case 'dblclick':
        if (this.#clickTimer) {
          clearTimeout(this.#clickTimer);
          this.#clickTimer = null;
        }
        break;
      case 'click':
        if (e.button !== 0) break;
        if (this.#suppressClick) {
          this.#suppressClick = false;
          break;
        }
        this.#handleClick(e);
        break;
      case 'contextmenu': {
        const hit = this.#featureHits(e.px)[0];
        this.#ctxSubs.forEach((cb) => cb({ featureId: hit?.id ?? null, coordinate: e.coordinate, pixel: [e.px[0], e.px[1]] }));
        break;
      }
      default:
        break;
    }
  }

  #handleClick(e: HostPointerEvent): void {
    if (this.#featurePointMode) {
      this.#pickFeaturePoint(e);
      return;
    }
    const emit = () => {
      this.#clickTimer = null;
      const hit = this.#featureHits(e.px)[0];
      if (hit) this.#clickSubs.forEach((cb) => cb(hit.id));
    };
    if (this.#clickTimer) clearTimeout(this.#clickTimer);
    if (this.#cfg.clickDelayMs <= 0) emit();
    else this.#clickTimer = setTimeout(emit, this.#cfg.clickDelayMs);
  }

  /** Click on a draft feature → report the click projected onto that feature's geometry. */
  #pickFeaturePoint(e: HostPointerEvent): void {
    const hit = this.#featureHits(e.px, this.#cfg.pickRadiusPx + 2).find((h) => h.layerId === 'draft');
    if (!hit) return;
    const g = this.#store.displayedGeometry('draft', hit.id);
    if (!g) return;
    const click = toMapPoint([e.coordinate.lon, e.coordinate.lat]);
    let best: { d: number; p: [number, number] } | null = null;
    const consider = (p: [number, number]) => {
      const d = Math.hypot(p[0] - click[0], p[1] - click[1]);
      if (!best || d < best.d) best = { d, p };
    };
    for (const p of geometryPoints(g)) consider(toMapPoint([p[0]!, p[1]!]));
    for (const line of geometryLines(g)) {
      for (let i = 1; i < line.length; i++) {
        const a = toMapPoint([line[i - 1]![0]!, line[i - 1]![1]!]);
        const b = toMapPoint([line[i]![0]!, line[i]![1]!]);
        consider(closestOnSegment(click, a, b).point);
      }
    }
    if (!best) return;
    const geo = toGeoPoint((best as { p: [number, number] }).p);
    this.#pointPickSubs.forEach((cb) => cb(hit.id, { lon: geo[0], lat: geo[1] }));
  }

  // ───────────────────────── rendering ─────────────────────────

  #requestRender(): void {
    if (this.#renderQueued || this.#destroyed) return;
    this.#renderQueued = true;
    queueMicrotask(() => {
      this.#renderQueued = false;
      if (!this.#destroyed && this.#mounted) this.#render();
    });
  }

  /** Synchronous render — exposed for tests and the host's resize path. */
  flush(): void {
    this.#renderQueued = false;
    if (!this.#destroyed && this.#mounted) this.#render();
  }

  #render(): void {
    const terrainOn = this.#terrain.enabled;
    const prepared = this.#store.prepare({
      selectedId: this.#selected,
      atlas: this.#atlas,
      groundZ: terrainOn ? (lon, lat) => this.#host.elevationAt({ lon, lat }) : null,
      terrainRevision: this.#terrainRevision,
    });
    const entries: LayerEntry[] = prepared.map((p) => ({ id: `${LAYER_PREFIX}${p.id}`, data: p.data, pickable: true }));
    // overlays paint above every feature layer, oldest interaction first
    [...this.#interactionList()].reverse().forEach((i, idx) => {
      const data = i.overlay?.();
      if (data) entries.push({ id: `${OVERLAY_PREFIX}${idx}`, data, pickable: false });
    });
    const cam = this.#host.getCamera();
    this.#solids = this.#solidsActive(cam.pitch, this.#host.getView().zoom);
    this.#staticLayers = buildDeckLayers(entries, this.#atlas.snapshot(), { solids: this.#solids });
    this.#flows = prepared.flatMap((p) => p.data.flows);
    // Redraw the current flow frame together with the new static layers. Pushing the static layers
    // alone would drop the flow layer until the next tick, so anything that re-renders (e.g. the
    // cursor moving over an editing tool's overlay) made the water blink.
    if (this.#flowEnabled && this.#flows.length > 0) this.#drawFlow(this.#now());
    else this.#host.setLayers(this.#staticLayers);
    this.#syncFlowLoop();
  }

  // ───────────────────────── water flow ─────────────────────────

  setFlowAnimation(enabled: boolean): void {
    if (this.#flowEnabled === enabled) return;
    this.#flowEnabled = enabled;
    if (!enabled) this.#host.setLayers(this.#staticLayers);
    this.#syncFlowLoop();
  }
  getFlowAnimation(): boolean {
    return this.#flowEnabled;
  }

  #syncFlowLoop(): void {
    const want = this.#flowEnabled && this.#flows.length > 0 && !this.#destroyed && this.#mounted;
    if (want && !this.#flowRaf) {
      if (!this.#flowStart) this.#flowStart = this.#now();
      this.#flowRaf = this.#raf(() => this.#flowTick());
    } else if (!want && this.#flowRaf) {
      this.#caf(this.#flowRaf);
      this.#flowRaf = 0;
    }
  }
  #now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
  #raf(cb: () => void): number {
    return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 33) as unknown as number);
  }
  #caf(id: number): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id);
  }
  #flowTick(): void {
    this.#flowRaf = 0;
    if (!this.#flowEnabled || this.#destroyed || this.#flows.length === 0) return;
    const now = this.#now();
    if (now - this.#flowLast >= 33) {
      this.#flowLast = now;
      this.#drawFlow(now);
    }
    this.#flowRaf = this.#raf(() => this.#flowTick());
  }
  /** One animation frame; exposed (via `flush`-style tests) so it can be driven without timers. */
  #drawFlow(now: number): void {
    const view = this.#host.getView();
    const metresPerPx = (156543.03392 * Math.cos((view.center.lat * Math.PI) / 180)) / 2 ** view.zoom;
    const time = (now - this.#flowStart) / 1000;
    if (!this.#solids) {
      // Flat pipes: sliding dashes (a dot would be wider than the stroke).
      const dashes = computeDashes(this.#flows, {
        time,
        metresPerPx,
        pxPerSecPerMps: FLOW_PX_PER_SEC_PER_MPS,
        periodPx: FLOW_DASH_PERIOD_PX,
        dashPx: FLOW_DASH_PX,
        view: this.#host.getVisibleBbox(),
        maxSegments: FLOW_MAX_DASH_SEGMENTS,
      });
      this.#host.setLayers([...this.#staticLayers, ...buildFlowDashLayer(dashes)]);
      return;
    }
    const particles = computeParticles(this.#flows, {
      time,
      metresPerPx,
      pxPerSecPerMps: FLOW_PX_PER_SEC_PER_MPS,
      spacingPx: FLOW_SPACING_PX,
      view: this.#host.getVisibleBbox(),
      solids: this.#solids,
      maxParticles: FLOW_MAX_PARTICLES,
      tail: [0],
    });
    this.#host.setLayers([...this.#staticLayers, ...buildFlowLayer(particles)]);
  }
  /** Test hook: draw one flow frame at `seconds` after start. */
  drawFlowFrameForTest(seconds: number): void {
    this.#drawFlow(this.#flowStart + seconds * 1000);
  }

  /** Tubes / solids replace flat strokes only when tilted and close enough to see them. */
  #solidsActive(pitch: number, zoom: number): boolean {
    return pitch > 1 && zoom >= this.#cfg.solidsMinZoom;
  }

  /** Test hook: last pointer event seen. */
  get lastPointer(): HostPointerEvent | null {
    return this.#lastPointer;
  }
}
