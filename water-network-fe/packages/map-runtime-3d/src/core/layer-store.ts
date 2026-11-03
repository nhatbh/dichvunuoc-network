import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { StyleSpec } from '@wn/map-runtime';
import type { IconAtlas } from '../layers/icon-atlas.js';
import { emptyPrepared, featureId, prepareLayer, type PreparedLayer } from '../layers/prepare-layer.js';

export interface StoredFeature {
  id: string;
  layerId: string;
  feature: Feature;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

interface LayerState {
  id: string;
  order: number;
  visible: boolean;
  collection: FeatureCollection;
  features: StoredFeature[];
  byId: Map<string, StoredFeature>;
  style?: StyleSpec;
  version: number;
  cache?: { key: string; base: PreparedLayer };
}

export function geometryPositions(g: Geometry | null | undefined): Position[] {
  if (!g) return [];
  switch (g.type) {
    case 'Point':
      return [g.coordinates];
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates;
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates.flat();
    case 'MultiPolygon':
      return g.coordinates.flat(2);
    case 'GeometryCollection':
      return g.geometries.flatMap(geometryPositions);
  }
}

export function geometryBbox(g: Geometry | null | undefined): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of geometryPositions(g)) {
    if (p[0]! < minX) minX = p[0]!;
    if (p[0]! > maxX) maxX = p[0]!;
    if (p[1]! < minY) minY = p[1]!;
    if (p[1]! > maxY) maxY = p[1]!;
  }
  return [minX, minY, maxX, maxY];
}

/** Line-like parts of a geometry (rings count as closed lines). */
export function geometryLines(g: Geometry | null | undefined): Position[][] {
  if (!g) return [];
  switch (g.type) {
    case 'LineString':
      return [g.coordinates];
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates;
    case 'MultiPolygon':
      return g.coordinates.flat();
    case 'GeometryCollection':
      return g.geometries.flatMap(geometryLines);
    default:
      return [];
  }
}

export function geometryPoints(g: Geometry | null | undefined): Position[] {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'MultiPoint') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(geometryPoints);
  return [];
}

export interface PrepareOptions {
  selectedId: string | null;
  atlas: IconAtlas;
  groundZ: ((lon: number, lat: number) => number | null) | null;
  /** Bumped whenever terrain samples change so cached geometry is rebuilt. */
  terrainRevision: number;
}

/**
 * Holds every vector layer the app pushed through `setFeatures`, in paint order,
 * and turns them into plain-data render lists. Rendering results are cached per
 * layer: a selection change only rebuilds the layers that contain the old / new
 * selected feature, a live-edit preview rebuilds only the previewed feature.
 */
export class LayerStore {
  #layers = new Map<string, LayerState>();
  #nextOrder = 0;
  #preview = new Map<string, Map<string, Geometry>>(); // layerId → fid → geometry

  has(layerId: string): boolean {
    return this.#layers.has(layerId);
  }

  set(layerId: string, collection: FeatureCollection, style?: StyleSpec): void {
    let layer = this.#layers.get(layerId);
    if (!layer) {
      layer = { id: layerId, order: this.#nextOrder++, visible: true, collection, features: [], byId: new Map(), version: 0 };
      this.#layers.set(layerId, layer);
    }
    layer.collection = collection;
    layer.features = [];
    layer.byId = new Map();
    for (const feature of collection.features) {
      const id = featureId(feature);
      if (id == null || !feature.geometry) continue;
      const stored: StoredFeature = { id, layerId, feature, bbox: geometryBbox(feature.geometry) };
      layer.features.push(stored);
      layer.byId.set(id, stored);
    }
    if (style) layer.style = style;
    layer.version++;
  }

  setStyle(layerId: string, style: StyleSpec): void {
    const layer = this.#layers.get(layerId);
    if (!layer) {
      // Style registered before any features: keep it for the first setFeatures.
      this.set(layerId, { type: 'FeatureCollection', features: [] }, style);
      return;
    }
    layer.style = style;
    layer.version++;
  }

  setVisible(layerId: string, visible: boolean): void {
    const layer = this.#layers.get(layerId);
    if (layer) layer.visible = visible;
  }

  isVisible(layerId: string): boolean {
    return this.#layers.get(layerId)?.visible ?? false;
  }

  collection(layerId: string): FeatureCollection | undefined {
    return this.#layers.get(layerId)?.collection;
  }

  getFeature(layerId: string, id: string): StoredFeature | undefined {
    return this.#layers.get(layerId)?.byId.get(id);
  }

  /** Topmost layer (latest painted) that contains a feature with this id. */
  findFeature(id: string): StoredFeature | undefined {
    for (const l of this.#orderedDesc()) {
      const f = l.byId.get(id);
      if (f) return f;
    }
    return undefined;
  }

  /** Geometry as currently displayed (live preview wins over stored). */
  displayedGeometry(layerId: string, id: string): Geometry | undefined {
    return this.#preview.get(layerId)?.get(id) ?? this.getFeature(layerId, id)?.feature.geometry;
  }

  setPreview(layerId: string, fid: string, geometry: Geometry | null): void {
    let m = this.#preview.get(layerId);
    if (geometry === null) {
      if (m?.delete(fid)) this.#bump(layerId);
      return;
    }
    if (!m) this.#preview.set(layerId, (m = new Map()));
    m.set(fid, geometry);
    this.#bump(layerId);
  }

  clearPreviews(layerId?: string): void {
    for (const id of layerId ? [layerId] : [...this.#preview.keys()]) {
      if (this.#preview.get(id)?.size) {
        this.#preview.get(id)!.clear();
        this.#bump(id);
      }
    }
  }

  touch(layerId?: string): void {
    for (const l of this.#layers.values()) if (!layerId || l.id === layerId) l.version++;
  }

  #bump(layerId: string): void {
    const l = this.#layers.get(layerId);
    if (l) l.version++;
  }

  #orderedAsc(): LayerState[] {
    return [...this.#layers.values()].sort((a, b) => a.order - b.order);
  }
  #orderedDesc(): LayerState[] {
    return this.#orderedAsc().reverse();
  }

  /** Visible layers' stored features, topmost layer first (hit-testing / snapping order). */
  *visibleFeatures(): IterableIterator<StoredFeature> {
    for (const l of this.#orderedDesc()) {
      if (!l.visible) continue;
      for (const f of l.features) yield f;
    }
  }

  layerIds(): string[] {
    return this.#orderedAsc().map((l) => l.id);
  }

  /** Render lists for every visible layer in paint order. */
  prepare(opts: PrepareOptions): Array<{ id: string; data: PreparedLayer }> {
    const out: Array<{ id: string; data: PreparedLayer }> = [];
    for (const l of this.#orderedAsc()) {
      if (!l.visible) continue;
      const previews = this.#preview.get(l.id) ?? new Map<string, Geometry>();
      const previewKey = [...previews.keys()].sort().join(',');
      const hasSelected = opts.selectedId != null && l.byId.has(opts.selectedId);
      const key = [l.version, hasSelected ? opts.selectedId : '-', previewKey, opts.terrainRevision, opts.groundZ ? 1 : 0].join('|');
      let base = l.cache?.key === key ? l.cache.base : undefined;
      if (!base) {
        const collection: FeatureCollection = previews.size
          ? { type: 'FeatureCollection', features: l.collection.features.filter((f) => !(featureId(f) != null && previews.has(featureId(f)!))) }
          : l.collection;
        base = prepareLayer(collection, l.style, {
          selectedId: hasSelected ? opts.selectedId : null,
          preview: new Map(),
          isDraft: l.id === 'draft',
          atlas: opts.atlas,
          groundZ: opts.groundZ,
        });
        l.cache = { key, base };
      }
      if (previews.size === 0) {
        out.push({ id: l.id, data: base });
        continue;
      }
      // previewed features are re-prepared on every change (small) and painted on top
      const live = prepareLayer(
        { type: 'FeatureCollection', features: l.collection.features.filter((f) => featureId(f) != null && previews.has(featureId(f)!)) },
        l.style,
        { selectedId: opts.selectedId, preview: previews, isDraft: l.id === 'draft', atlas: opts.atlas, groundZ: opts.groundZ },
      );
      out.push({ id: l.id, data: concatPrepared(base, live) });
    }
    return out;
  }

  clear(): void {
    this.#layers.clear();
    this.#preview.clear();
  }
}

export function concatPrepared(a: PreparedLayer, b: PreparedLayer): PreparedLayer {
  const out = emptyPrepared();
  for (const k of Object.keys(out) as Array<keyof PreparedLayer>) {
    (out[k] as unknown[]) = [...(a[k] as unknown[]), ...(b[k] as unknown[])];
  }
  return out;
}
