import { ColumnLayer, IconLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import type { Layer } from '@deck.gl/core';
import { boxMesh, cylinderMesh, sphereMesh } from './meshes.js';
import type { AtlasSnapshot } from './icon-atlas.js';
import type { ColumnDatum, LineDatum, MeshDatum, PreparedLayer, SolidDatum, TextDatum } from './prepare-layer.js';

export interface LayerEntry {
  /** Unique id; feature-layer ids come through unchanged so hits map back to the layer. */
  id: string;
  data: PreparedLayer;
  /** Only pickable entries take part in hit-testing (overlays such as sketches are not). */
  pickable: boolean;
}

// Flat (map-plane) layers paint in submission order, like OpenLayers; extrusions use real depth.
const FLAT = { depthCompare: 'always', depthWriteEnabled: false } as const;
const SOLID = { depthCompare: 'less-equal', depthWriteEnabled: true } as const;

// Meshes are created once (stable references keep deck from re-uploading geometry).
let MESHES: { cylinder: ReturnType<typeof cylinderMesh>; sphere: ReturnType<typeof sphereMesh>; box: ReturnType<typeof boxMesh> } | null = null;
const meshes = () => (MESHES ??= { cylinder: cylinderMesh(), sphere: sphereMesh(), box: boxMesh() });
const MESH_MATERIAL = { ambient: 0.45, diffuse: 0.7, shininess: 40, specularColor: [90, 96, 104] } as const;

function meshLayer(id: string, data: MeshDatum[], mesh: unknown, pickable: boolean): Layer[] {
  if (data.length === 0) return [];
  return [
    new SimpleMeshLayer<MeshDatum>({
      id,
      data,
      mesh: mesh as never,
      getPosition: (d: MeshDatum) => d.position,
      getTransformMatrix: (d: MeshDatum) => d.matrix,
      getColor: (d: MeshDatum) => rgb(d.color),
      material: MESH_MATERIAL as never,
      pickable,
      parameters: SOLID,
    } as never),
  ];
}

const DASH = [new PathStyleExtension({ dash: true })];

const rgb = (c: readonly number[]): [number, number, number, number] => [c[0]!, c[1]!, c[2]!, c[3] ?? 255];

function pathLayers(id: string, lines: LineDatum[], pickable: boolean): Layer[] {
  if (lines.length === 0) return [];
  const solid = lines.filter((l) => !l.dash);
  const dashed = lines.filter((l) => l.dash);
  const out: Layer[] = [];
  const common = {
    getPath: (d: LineDatum) => d.path,
    getColor: (d: LineDatum) => rgb(d.color),
    getWidth: (d: LineDatum) => d.width,
    widthUnits: 'pixels' as const,
    capRounded: true,
    jointRounded: true,
    pickable,
    parameters: FLAT,
  };
  if (solid.length) out.push(new PathLayer<LineDatum>({ ...common, id: `${id}:solid`, data: solid }));
  if (dashed.length) {
    out.push(
      new PathLayer<LineDatum>({
        ...common,
        id: `${id}:dash`,
        data: dashed,
        extensions: DASH,
        // dash arrays are expressed in multiples of the line width
        getDashArray: (d: LineDatum) => [d.dash![0] / Math.max(d.width, 0.5), d.dash![1] / Math.max(d.width, 0.5)],
        dashJustified: false,
      } as never),
    );
  }
  return out;
}

function textLayers(id: string, texts: TextDatum[]): Layer[] {
  if (texts.length === 0) return [];
  const groups = new Map<string, TextDatum[]>();
  for (const t of texts) {
    const k = `${t.family}|${t.outline ? t.outline.join(',') : ''}|${t.outlineWidth}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  return [...groups.entries()].map(([k, data], i) => {
    const first = data[0]!;
    return new TextLayer<TextDatum>({
      id: `${id}:text${i}:${k.length}`,
      data,
      getPosition: (d: TextDatum) => d.position,
      getText: (d: TextDatum) => d.text,
      getSize: (d: TextDatum) => d.size,
      getColor: (d: TextDatum) => rgb(d.color),
      getPixelOffset: (d: TextDatum) => [0, d.offsetY],
      fontFamily: first.family,
      fontSettings: { sdf: true },
      outlineWidth: first.outline ? first.outlineWidth : 0,
      outlineColor: first.outline ? rgb(first.outline) : [255, 255, 255, 255],
      characterSet: 'auto',
      billboard: true,
      sizeUnits: 'pixels',
      parameters: FLAT,
    } as never);
  });
}

function columnLayers(id: string, columns: ColumnDatum[], pickable: boolean): Layer[] {
  if (columns.length === 0) return [];
  const groups = new Map<string, ColumnDatum[]>();
  for (const c of columns) {
    const k = `${c.radius}|${c.sides}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
  }
  return [...groups.entries()].map(
    ([k, data]) =>
      new ColumnLayer<ColumnDatum>({
        id: `${id}:col:${k}`,
        data,
        getPosition: (d: ColumnDatum) => d.position,
        getElevation: (d: ColumnDatum) => d.height,
        getFillColor: (d: ColumnDatum) => rgb(d.color),
        radius: data[0]!.radius,
        diskResolution: Math.max(4, data[0]!.sides),
        extruded: true,
        pickable,
        material: { ambient: 0.55, diffuse: 0.6, shininess: 24, specularColor: [60, 64, 70] },
        parameters: SOLID,
      } as never),
  );
}

/** Translate prepared (plain-data) layers into deck.gl layer instances, in paint order. */
export interface BuildOptions {
  /** Show tubes / solids (close, tilted camera) and hide the flat strokes / icons they replace. */
  solids?: boolean;
}

export function buildDeckLayers(entries: LayerEntry[], atlas: AtlasSnapshot, opts: BuildOptions = {}): Layer[] {
  const out: Layer[] = [];
  for (const { id, data, pickable } of entries) {
    const flat = data.polygons.filter((p) => p.height <= 0);
    const solid = data.polygons.filter((p) => p.height > 0);
    if (flat.length) {
      out.push(
        new SolidPolygonLayer({
          id: `${id}:fill`,
          data: flat,
          getPolygon: (d: (typeof flat)[number]) => d.polygon,
          getFillColor: (d: (typeof flat)[number]) => rgb(d.fill),
          extruded: false,
          pickable,
          parameters: FLAT,
        } as never),
      );
    }
    out.push(...pathLayers(`${id}:halo`, data.halos, false));
    const showSolids = !!opts.solids;
    out.push(...pathLayers(`${id}:line`, showSolids ? data.lines.filter((l) => !l.tubed) : data.lines, pickable));
    if (showSolids) {
      const m = meshes();
      out.push(...meshLayer(`${id}:tube`, data.tubes, m.cylinder, pickable));
      out.push(...meshLayer(`${id}:joint`, data.joints, m.sphere, pickable));
      for (const shape of ['box', 'cylinder', 'sphere'] as const) {
        out.push(...meshLayer(`${id}:solid-${shape}`, data.solids.filter((s: SolidDatum) => s.shape === shape), m[shape], pickable));
      }
    }
    if (data.pointHalos.length) {
      out.push(
        new ScatterplotLayer({
          id: `${id}:ring`,
          data: data.pointHalos,
          getPosition: (d: (typeof data.pointHalos)[number]) => d.position,
          getRadius: (d: (typeof data.pointHalos)[number]) => d.radius,
          getLineColor: (d: (typeof data.pointHalos)[number]) => rgb(d.color),
          getLineWidth: (d: (typeof data.pointHalos)[number]) => d.width,
          radiusUnits: 'pixels',
          lineWidthUnits: 'pixels',
          stroked: true,
          filled: false,
          billboard: true,
          parameters: FLAT,
        } as never),
      );
    }
    const icons = showSolids ? data.points.filter((p) => !p.solid) : data.points;
    if (icons.length && atlas.canvas) {
      out.push(
        new IconLayer({
          id: `${id}:icon`,
          data: icons,
          iconAtlas: atlas.canvas as never,
          iconMapping: atlas.mapping,
          getIcon: (d: (typeof data.points)[number]) => d.iconKey,
          getPosition: (d: (typeof data.points)[number]) => d.position,
          getSize: (d: (typeof data.points)[number]) => d.iconSize,
          sizeUnits: 'pixels',
          pickable,
          parameters: FLAT,
          updateTriggers: { getIcon: atlas.version },
        } as never),
      );
    }
    out.push(...columnLayers(id, data.columns, pickable));
    if (solid.length) {
      out.push(
        new SolidPolygonLayer({
          id: `${id}:block`,
          data: solid,
          getPolygon: (d: (typeof solid)[number]) => d.polygon,
          getFillColor: (d: (typeof solid)[number]) => rgb(d.fill),
          getElevation: (d: (typeof solid)[number]) => d.height,
          extruded: true,
          pickable,
          material: { ambient: 0.55, diffuse: 0.6, shininess: 24, specularColor: [60, 64, 70] },
          parameters: SOLID,
        } as never),
      );
    }
    out.push(...textLayers(id, data.texts));
  }
  return out;
}

/** Water-flow particles for this frame (binary attributes: one deck draw, no per-object accessors). */
export function buildFlowLayer(p: { count: number; positions: Float64Array; radii: Float32Array; colors: Uint8ClampedArray }): Layer[] {
  if (p.count === 0) return [];
  return [
    new ScatterplotLayer({
      id: 'wn-flow',
      data: {
        length: p.count,
        attributes: {
          getPosition: { value: p.positions.slice(0, p.count * 3), size: 3 },
          getRadius: { value: p.radii.slice(0, p.count), size: 1 },
          getFillColor: { value: p.colors.slice(0, p.count * 4), size: 4 },
        },
      },
      radiusUnits: 'meters',
      radiusMinPixels: 1.4,
      billboard: true,
      stroked: false,
      filled: true,
      pickable: false,
      parameters: FLAT,
    } as never),
  ];
}

/** Flat-map flow dashes for this frame (binary attributes, one draw). */
export function buildFlowDashLayer(d: { count: number; sources: Float64Array; targets: Float64Array; colors: Uint8ClampedArray; widths: Float32Array }): Layer[] {
  if (d.count === 0) return [];
  return [
    new LineLayer({
      id: 'wn-flow-dash',
      data: {
        length: d.count,
        attributes: {
          getSourcePosition: { value: d.sources.slice(0, d.count * 3), size: 3 },
          getTargetPosition: { value: d.targets.slice(0, d.count * 3), size: 3 },
          getColor: { value: d.colors.slice(0, d.count * 4), size: 4 },
          getWidth: { value: d.widths.slice(0, d.count), size: 1 },
        },
      },
      widthUnits: 'pixels',
      pickable: false,
      parameters: FLAT,
    } as never),
  ];
}
