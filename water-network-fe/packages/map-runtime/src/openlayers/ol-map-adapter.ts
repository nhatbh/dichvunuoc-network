import OLMap from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls } from 'ol/control/defaults';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Draw from 'ol/interaction/Draw';
import type { DrawEvent, GeometryFunction, SketchCoordType } from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import type { ModifyEvent } from 'ol/interaction/Modify';
import Snap from 'ol/interaction/Snap';
import DragBox from 'ol/interaction/DragBox';
import { always } from 'ol/events/condition';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import type SimpleGeometry from 'ol/geom/SimpleGeometry';
import type OlGeometry from 'ol/geom/Geometry';
import type { FeatureLike } from 'ol/Feature';
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style';
import { getLength } from 'ol/sphere';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import type { FeatureCollection, Geometry } from 'geojson';
import type { MapEnginePort } from '../port/map-engine-port.js';
import type { GeometryEditTarget, GeometryEditComplete, GeometryVertexSelection, Coordinate, ContextMenuEvent, DrawConstraint, DrawGeometry, Extent, FitOptions, MapViewOptions, SnapModes, StyleSpec, Viewport } from '../port/types.js';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';
import type { BasemapId } from '../basemaps.js';
import { styleForKind, buildStyle } from './style-adapter.js';
import { createBasemapSource } from './basemaps.js';
import { createGeometryEditInteraction, type GeometryEditController } from './geometry-edit-interaction.js';
import { registerVietnamCrs } from './crs.js';

const DATA_PROJECTION = 'EPSG:4326';
const VIEW_PROJECTION = 'EPSG:3857';

export class OlMapAdapter implements MapEnginePort {
  #map: OLMap | null = null;
  #view: View;
  #base = new TileLayer({ source: createBasemapSource('osm') ?? undefined });
  #layers = new Map<string, VectorLayer<VectorSource>>();
  #styleSpecs = new Map<string, StyleSpec>();
  #selected: string | null = null;
  #clickSubs = new Set<(id: string) => void>();
  #pointerSubs = new Set<(c: Coordinate | null) => void>();
  #format = new GeoJSON({ dataProjection: DATA_PROJECTION, featureProjection: VIEW_PROJECTION });
  #drawSource = new VectorSource();
  #draw: Draw | null = null;
  #drawSubs = new Set<(g: Geometry) => void>();
  #modify: Modify | null = null;
  #modifyEnabled = false;
  #geometryTarget: GeometryEditTarget | null = null;
  #geometryController: GeometryEditController | null = null;
  #geometrySubs = new Set<(event: GeometryEditComplete) => void>();
  #vertexSubs = new Set<(selection: GeometryVertexSelection | null) => void>();
  #featureData = new Map<string, FeatureCollection>();
  #pendingFeatures = new Map<string, { features: FeatureCollection; style?: StyleSpec }>();
  #modifySubs = new Set<(id: string, g: Geometry) => void>();
  #snaps: Snap[] = [];
  #snapModes: SnapModes = { node: true, vertex: true, edge: true };
  #drawGeometry: DrawGeometry | null = null;
  #drawConstraint: DrawConstraint = null;
  #drawMeasure = false;
  #featurePointMode = false;
  #featurePointSubs = new Set<(id: string, c: Coordinate) => void>();
  #dragBox: DragBox | null = null;
  #boxSubs = new Set<(ids: string[]) => void>();
  #ctxMenuSubs = new Set<(e: ContextMenuEvent) => void>();

  constructor(opts: MapViewOptions) {
    registerVietnamCrs();
    const projection = opts.projection ?? VIEW_PROJECTION;
    this.#view = new View({
      center: fromLonLat([opts.center.lon, opts.center.lat], projection),
      zoom: opts.zoom,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      projection,
    });
  }

  mount(target: HTMLElement): void {
    // No default OpenLayers controls — the app supplies its own styled controls
    // (zoom + basemap switcher, top-right). The app does not import ol/ol.css, so
    // OL's built-in controls would render unstyled in the top-left. Attribution text
    // is hidden per product request (tile-provider attribution is shown in the
    // app's "Về cổng"/footer / docs instead).
    this.#map = new OLMap({
      target,
      view: this.#view,
      layers: [this.#base],
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
    });
    this.#map.on('singleclick', (evt) => {
      if (this.#featurePointMode) {
        // undefined when 'draft' has no features yet → filter matches nothing, pick silently no-ops.
        const draftLayer = this.#layers.get('draft');
        const picked = this.#map?.forEachFeatureAtPixel(evt.pixel, (f) => f, {
          layerFilter: (l) => l === draftLayer,
        });
        const g = picked?.getGeometry() as OlGeometry | undefined;
        const id = picked?.getId();
        if (picked && g && id != null) {
          const onLine = g.getClosestPoint(evt.coordinate);
          const [lon, lat] = toLonLat(onLine, this.#view.getProjection());
          this.#featurePointSubs.forEach((cb) => cb(String(id), { lon: lon ?? 0, lat: lat ?? 0 }));
        }
        return;
      }
      const hit = this.#map?.forEachFeatureAtPixel(evt.pixel, (f) => f.getId(), { layerFilter: (layer) => !layer.get('geometryEditHandles') });
      if (hit != null) this.#clickSubs.forEach((cb) => cb(String(hit)));
    });
    this.#map.on('pointermove', (evt) => {
      const [lon, lat] = toLonLat(evt.coordinate, this.#view.getProjection());
      this.#pointerSubs.forEach((cb) => cb({ lon: lon ?? 0, lat: lat ?? 0 }));
    });
    // Newer ol typings declare getViewport() as possibly undefined; accept both.
    const viewport = this.#map.getViewport() as HTMLElement | undefined;
    viewport?.addEventListener('mouseleave', () => {
      this.#pointerSubs.forEach((cb) => cb(null));
    });
    viewport?.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (!this.#map) return;
      const pixel = this.#map.getEventPixel(e);
      const coord = this.#map.getEventCoordinate(e);
      const hit = this.#map.forEachFeatureAtPixel(pixel, (f) => f.getId(), { layerFilter: (layer) => !layer.get('geometryEditHandles') });
      const [lon, lat] = toLonLat(coord, this.#view.getProjection());
      this.#ctxMenuSubs.forEach((cb) =>
        cb({
          featureId: hit != null ? String(hit) : null,
          coordinate: { lon: lon ?? 0, lat: lat ?? 0 },
          pixel: [pixel[0] ?? 0, pixel[1] ?? 0],
        }),
      );
    });
    for (const [layerId, pending] of this.#pendingFeatures) this.setFeatures(layerId, pending.features, pending.style);
    this.#pendingFeatures.clear();
    this.#syncGeometryController();
    if (this.#drawGeometry) this.setDrawMode(this.#drawGeometry);
    if (this.#modifyEnabled) this.setModifyMode(true);
  }

  setFeatures(layerId: string, features: FeatureCollection, style?: StyleSpec): void {
    if (!this.#map) {
      this.#pendingFeatures.set(layerId, { features: structuredClone(features), style });
      return;
    }
    let layer = this.#layers.get(layerId);
    if (!layer) {
      layer = new VectorLayer({ source: new VectorSource() });
      this.#layers.set(layerId, layer);
      this.#map.addLayer(layer);
    }
    const src = layer.getSource();
    if (!src) return;
    const incoming = this.#format.readFeatures(features);
    const targetId = layerId === 'draft' ? this.#geometryTarget?.featureId : undefined;
    const existing = targetId ? src.getFeatureById(targetId) : null;
    const previous = targetId ? this.#featureData.get(layerId)?.features.find((f) => String(f.id) === targetId) : null;
    const next = targetId ? features.features.find((f) => String(f.id) === targetId) : null;
    // Retain the live target and its preview/selection when only properties or other assets rerender.
    const preserveTarget = existing && previous && next && JSON.stringify(previous.geometry) === JSON.stringify(next.geometry);
    if (layerId === 'draft' && !preserveTarget) this.#clearGeometryController();
    if (preserveTarget) {
      const index = incoming.findIndex((f) => String(f.getId()) === targetId);
      if (index >= 0) {
        const properties = incoming[index]!.getProperties(); delete properties.geometry;
        existing.setProperties(properties, true);
        incoming[index] = existing;
      }
    }
    src.clear(); src.addFeatures(incoming);
    this.#featureData.set(layerId, structuredClone(features));
    if (style) this.#styleSpecs.set(layerId, style);
    this.#applyLayerStyle(layerId, layer);
    this.#syncGeometryController();
    this.#syncSnap();
  }

  setLayerStyle(layerId: string, style: StyleSpec): void {
    this.#styleSpecs.set(layerId, style);
    const layer = this.#layers.get(layerId);
    if (layer) this.#applyLayerStyle(layerId, layer);
  }

  /** Bind a layer's render style: custom plain spec if registered, else built-in kind style. */
  #applyLayerStyle(layerId: string, layer: VectorLayer<VectorSource>): void {
    const spec = this.#styleSpecs.get(layerId);
    const isDraft = layerId === 'draft';
    if (spec) {
      layer.setStyle((feat) => {
        const props = { ...feat.getProperties(), __selected: feat.getId() === this.#selected };
        delete (props as { geometry?: unknown }).geometry;
        const resolved = spec(props as Record<string, unknown> & { __selected?: boolean });
        if (!resolved) {
          const kind = (feat.get('kind') ?? 'component') as NetworkFeatureKind;
          return styleForKind(kind, feat.getId() === this.#selected, isDraft);
        }
        return buildStyle(resolved) as Style[];
      });
    } else {
      layer.setStyle((feat) => {
        const kind = (feat.get('kind') ?? 'component') as NetworkFeatureKind;
        return styleForKind(kind, feat.getId() === this.#selected, isDraft);
      });
    }
  }

  setView(v: Viewport): void {
    this.#view.setCenter(fromLonLat([v.center.lon, v.center.lat], this.#view.getProjection()));
    this.#view.setZoom(v.zoom);
  }

  getView(): Viewport {
    const center = toLonLat(this.#view.getCenter() ?? [0, 0], this.#view.getProjection());
    return { center: { lon: center[0] ?? 0, lat: center[1] ?? 0 }, zoom: this.#view.getZoom() ?? 0 };
  }

  setSelection(featureId: string | null): void {
    if (this.#geometryTarget && featureId !== this.#geometryTarget.featureId) this.setGeometryEditTarget(null);
    this.#selected = featureId;
    this.#layers.forEach((l) => l.changed());
  }

  getSelection(): string | null {
    return this.#selected;
  }

  onFeatureClick(cb: (id: string) => void): () => void {
    this.#clickSubs.add(cb);
    return () => this.#clickSubs.delete(cb);
  }

  onPointerMove(cb: (c: Coordinate | null) => void): () => void {
    this.#pointerSubs.add(cb);
    return () => this.#pointerSubs.delete(cb);
  }

  setDrawMode(geometry: DrawGeometry | null): void {
    if (geometry) { this.setGeometryEditTarget(null); this.setModifyMode(false); }
    this.#drawGeometry = geometry;
    if (this.#draw) {
      this.#map?.removeInteraction(this.#draw);
      this.#draw = null;
    }
    if (geometry && this.#map) {
      this.#drawSource.clear();
      const useOrtho = geometry === 'LineString' && this.#drawConstraint === 'ortho';
      const draw = new Draw({
        source: this.#drawSource,
        type: geometry,
        geometryFunction: useOrtho ? orthoGeometryFunction : undefined,
        style: this.#drawMeasure && geometry === 'LineString' ? measureSketchStyle : undefined,
      });
      draw.on('drawend', (evt: DrawEvent) => {
        const g = evt.feature.getGeometry();
        if (!g) return;
        const geojson = this.#format.writeGeometryObject(g, {
          featureProjection: VIEW_PROJECTION,
          dataProjection: DATA_PROJECTION,
        }) as Geometry;
        this.#drawSubs.forEach((cb) => cb(geojson));
      });
      this.#map.addInteraction(draw);
      this.#draw = draw;
    }
    this.#syncSnap();
  }

  onDrawComplete(cb: (g: Geometry) => void): () => void {
    this.#drawSubs.add(cb);
    return () => this.#drawSubs.delete(cb);
  }

  setModifyMode(enabled: boolean): void {
    if (enabled) { this.setGeometryEditTarget(null); this.setDrawMode(null); }
    this.#modifyEnabled = enabled;
    if (this.#modify) {
      this.#map?.removeInteraction(this.#modify);
      this.#modify = null;
    }
    if (enabled && this.#map) {
      const src = this.#layers.get('draft')?.getSource();
      if (src) {
        const modify = new Modify({ source: src });
        modify.on('modifyend', (evt: ModifyEvent) => {
          evt.features.forEach((feature) => {
            const g = feature.getGeometry();
            const id = feature.getId();
            if (!g || id == null) return;
            const geojson = this.#format.writeGeometryObject(g, {
              featureProjection: VIEW_PROJECTION,
              dataProjection: DATA_PROJECTION,
            }) as Geometry;
            this.#modifySubs.forEach((cb) => cb(String(id), geojson));
          });
        });
        this.#map.addInteraction(modify);
        this.#modify = modify;
      }
    }
    this.#syncSnap();
  }

  setGeometryEditTarget(target: GeometryEditTarget | null): void {
    if (JSON.stringify(target) === JSON.stringify(this.#geometryTarget)) {
      this.#syncGeometryController(); return;
    }
    this.#clearGeometryController();
    this.#geometryTarget = target ? { ...target, lockedEndpointIndices: [...target.lockedEndpointIndices] } : null;
    if (target) { this.setDrawMode(null); this.setModifyMode(false); }
    this.#syncGeometryController(); this.#syncSnap();
  }

  onGeometryEditComplete(cb: (event: GeometryEditComplete) => void): () => void {
    this.#geometrySubs.add(cb); return () => this.#geometrySubs.delete(cb);
  }

  onGeometryVertexSelect(cb: (selection: GeometryVertexSelection | null) => void): () => void {
    this.#vertexSubs.add(cb); return () => this.#vertexSubs.delete(cb);
  }

  deleteSelectedGeometryVertex(): void { this.#geometryController?.deleteSelectedVertex(); }

  #clearGeometryController(): void {
    this.#geometryController?.destroy(); this.#geometryController = null;
    this.#vertexSubs.forEach((cb) => cb(null));
  }

  #syncGeometryController(): void {
    if (this.#geometryController || !this.#map || !this.#geometryTarget) return;
    const feature = this.#layers.get('draft')?.getSource()?.getFeatureById(this.#geometryTarget.featureId);
    if (!feature) return;
    this.#geometryController = createGeometryEditInteraction({
      map: this.#map, feature, target: this.#geometryTarget,
      snapModes: () => this.#snapModes,
      snapFeatures: () => [...this.#layers.values()].flatMap((layer) => layer.getSource()?.getFeatures() ?? []),
      onComplete: (event) => this.#geometrySubs.forEach((cb) => cb(event)),
      onVertexSelect: (selection) => this.#vertexSubs.forEach((cb) => cb(selection)),
    });
  }

  onModifyComplete(cb: (id: string, g: Geometry) => void): () => void {
    this.#modifySubs.add(cb);
    return () => this.#modifySubs.delete(cb);
  }

  setFeaturePointMode(enabled: boolean): void {
    if (enabled) this.setGeometryEditTarget(null);
    this.#featurePointMode = enabled;
  }

  onFeaturePointPick(cb: (id: string, c: Coordinate) => void): () => void {
    this.#featurePointSubs.add(cb);
    return () => this.#featurePointSubs.delete(cb);
  }

  setDrawConstraint(constraint: DrawConstraint): void {
    if (this.#drawConstraint === constraint) return;
    this.#drawConstraint = constraint;
    // Rebuild the active draw so the constraint takes effect immediately.
    if (this.#draw) this.setDrawMode(this.#drawGeometry);
  }

  setDrawMeasure(enabled: boolean): void {
    if (this.#drawMeasure === enabled) return;
    this.#drawMeasure = enabled;
    if (this.#draw) this.setDrawMode(this.#drawGeometry);
  }

  setBoxSelectMode(enabled: boolean): void {
    if (enabled) this.setGeometryEditTarget(null);
    if (this.#dragBox) {
      this.#map?.removeInteraction(this.#dragBox);
      this.#dragBox = null;
    }
    if (enabled && this.#map) {
      const box = new DragBox({ condition: always });
      box.on('boxend', () => {
        const extent = box.getGeometry().getExtent();
        const ids = new Set<string>();
        for (const layer of this.#layers.values()) {
          layer.getSource()?.forEachFeatureIntersectingExtent(extent, (f) => {
            const id = f.getId();
            if (id != null) ids.add(String(id));
          });
        }
        this.#boxSubs.forEach((cb) => cb([...ids]));
      });
      this.#map.addInteraction(box);
      this.#dragBox = box;
    }
  }

  onBoxSelect(cb: (ids: string[]) => void): () => void {
    this.#boxSubs.add(cb);
    return () => this.#boxSubs.delete(cb);
  }

  onContextMenu(cb: (e: ContextMenuEvent) => void): () => void {
    this.#ctxMenuSubs.add(cb);
    return () => this.#ctxMenuSubs.delete(cb);
  }

  setSnapModes(modes: SnapModes): void {
    this.#snapModes = modes;
    this.#syncSnap();
  }

  /** Rebuild snap interactions over every vector source while a draw or modify is active.
   * OSNAP modes map onto OL Snap's `vertex`/`edge` options: `node`+`vertex` both snap to
   * vertices, `edge` snaps to segment interiors. All-off skips snapping entirely. */
  #syncSnap(): void {
    for (const snap of this.#snaps) this.#map?.removeInteraction(snap);
    this.#snaps = [];
    const editing = this.#draw != null || this.#modify != null;
    if (!editing || !this.#map) return;
    const vertex = this.#snapModes.node || this.#snapModes.vertex;
    const edge = this.#snapModes.edge;
    if (!vertex && !edge) return;
    for (const layer of this.#layers.values()) {
      const src = layer.getSource();
      if (!src) continue;
      const snap = new Snap({ source: src, vertex, edge });
      this.#map.addInteraction(snap);
      this.#snaps.push(snap);
    }
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.#layers.get(layerId)?.setVisible(visible);
  }

  setBasemap(basemapId: string): void {
    const source = createBasemapSource(basemapId as BasemapId);
    if (source) {
      this.#base.setSource(source);
      this.#base.setVisible(true);
    } else {
      this.#base.setVisible(false);
    }
  }

  fitToBbox(extent: Extent, opts: FitOptions = {}): void {
    if (!this.#map) return;
    const viewExtent = transformExtent(extent, DATA_PROJECTION, this.#view.getProjection());
    const pad = opts.padding ?? 32;
    this.#view.fit(viewExtent, {
      size: this.#map.getSize() ?? undefined,
      padding: [pad, pad, pad, pad],
      maxZoom: opts.maxZoom,
    });
  }

  destroy(): void {
    this.#clearGeometryController(); this.#geometryTarget = null;
    this.#geometrySubs.clear(); this.#vertexSubs.clear(); this.#featureData.clear(); this.#pendingFeatures.clear();
    if (this.#draw) {
      this.#map?.removeInteraction(this.#draw);
      this.#draw = null;
    }
    if (this.#modify) {
      this.#map?.removeInteraction(this.#modify);
      this.#modify = null;
    }
    for (const snap of this.#snaps) this.#map?.removeInteraction(snap);
    this.#snaps = [];
    if (this.#dragBox) {
      this.#map?.removeInteraction(this.#dragBox);
      this.#dragBox = null;
    }
    this.#modifySubs.clear();
    this.#map?.setTarget(undefined);
    this.#map = null;
    this.#layers.clear();
    this.#styleSpecs.clear();
    this.#clickSubs.clear();
    this.#pointerSubs.clear();
    this.#drawSubs.clear();
    this.#drawSource.clear();
    this.#featurePointMode = false;
    this.#featurePointSubs.clear();
    this.#boxSubs.clear();
    this.#ctxMenuSubs.clear();
    this.#drawMeasure = false;
  }
}

/** Draw `geometryFunction` that locks the last segment of a sketched line to the
 * nearest 45° from the previous vertex (AutoCAD ORTHO), in view-projection coords. */
const orthoGeometryFunction: GeometryFunction = (coordinates, geometry) => {
  const coords = (coordinates as SketchCoordType as number[][]).map((c) => [c[0]!, c[1]!] as [number, number]);
  if (coords.length >= 2) {
    const prev = coords[coords.length - 2]!;
    const last = coords[coords.length - 1]!;
    const dx = last[0] - prev[0];
    const dy = last[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const step = Math.PI / 4;
      const a = Math.round(Math.atan2(dy, dx) / step) * step;
      coords[coords.length - 1] = [prev[0] + Math.cos(a) * len, prev[1] + Math.sin(a) * len];
    }
  }
  if (geometry) {
    (geometry as LineString).setCoordinates(coords);
    return geometry;
  }
  return new LineString(coords) as SimpleGeometry;
};

const MEASURE_ACCENT = '#0E7C86';
const fmtLen = (m: number): string => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');

/** Draw sketch style with a live length readout (real ground metres) + vertex dots. */
function measureSketchStyle(feature: FeatureLike): Style[] {
  const geom = feature.getGeometry();
  const styles: Style[] = [new Style({ stroke: new Stroke({ color: MEASURE_ACCENT, width: 3 }) })];
  if (geom instanceof LineString) {
    const coords = geom.getCoordinates();
    for (const c of coords) {
      styles.push(new Style({ geometry: new Point(c), image: new CircleStyle({ radius: 3, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: MEASURE_ACCENT, width: 1.5 }) }) }));
    }
    const last = coords[coords.length - 1];
    if (last && coords.length >= 2) {
      styles.push(
        new Style({
          geometry: new Point(last),
          text: new Text({ text: fmtLen(getLength(geom)), offsetY: -14, font: '11px monospace', fill: new Fill({ color: MEASURE_ACCENT }), stroke: new Stroke({ color: '#fff', width: 3 }) }),
        }),
      );
    }
  }
  return styles;
}
