import { ColumnLayer, IconLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import type { Layer } from '@deck.gl/core';
import { arrowMesh, boxMesh, cylinderMesh, sphereMesh } from './meshes.js';
import { buildComponentLayers, buildSymbolLayers, componentModelsLoaded } from './components.js';
import type { AtlasSnapshot } from './icon-atlas.js';
import type { ColumnDatum, ComponentDatum, LineDatum, MeshDatum, PreparedLayer, SolidDatum, TextDatum } from './prepare-layer.js';
import { FlowArrowLayer } from './flow-arrow-layer.js';
import type { ArrowInstance } from './flow.js';

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
let MESHES: { cylinder: ReturnType<typeof cylinderMesh>; sphere: ReturnType<typeof sphereMesh>; box: ReturnType<typeof boxMesh>; arrow: ReturnType<typeof arrowMesh> } | null = null;
// Tessellation kept modest: thousands of instances are drawn, and smooth normals hide the facets.
const meshes = () => (MESHES ??= { cylinder: cylinderMesh(16), sphere: sphereMesh(8, 16), box: boxMesh(), arrow: arrowMesh() });
// satin coated metal: soft diffuse, a tight low specular highlight (no plastic shine)
const MESH_MATERIAL = { ambient: 0.42, diffuse: 0.62, shininess: 72, specularColor: [70, 78, 88] } as const;
// arrows read as markings painted on the pipe: mostly self-lit so they stay legible on the shaded side
const ARROW_MATERIAL = { ambient: 0.85, diffuse: 0.25, shininess: 16, specularColor: [30, 30, 30] } as const;

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
  /**
   * Only build 3D solids (tubes, joints, models) inside this [minLon, minLat, maxLon, maxLat] box.
   * deck.gl draws every instance it is given, on or off screen, so up close the engine passes the
   * view padded on all sides and rebuilds when the camera leaves it.
   */
  cull?: readonly number[] | null;
}

// Layers built for an entry are reused while its data and the options are unchanged: deck.gl then sees
// the same props and skips recomputing attributes (re-filtering into new arrays made it redo them all).
const built = new WeakMap<PreparedLayer, { key: string; pickable: boolean; id: string; layers: Layer[] }>();

const inBox = (p: readonly number[], b: readonly number[] | null | undefined): boolean => !b || (p[0]! >= b[0]! && p[0]! <= b[2]! && p[1]! >= b[1]! && p[1]! <= b[3]!);

export function buildDeckLayers(entries: LayerEntry[], atlas: AtlasSnapshot, opts: BuildOptions = {}): Layer[] {
  const out: Layer[] = [];
  const key = `${opts.solids ? 1 : 0}|${opts.solids && opts.cull ? opts.cull.map((v) => v.toFixed(5)).join(',') : ''}|${atlas.version}|${componentModelsLoaded() ? 1 : 0}`;
  for (const entry of entries) {
    const hit = built.get(entry.data);
    if (hit && hit.key === key && hit.pickable === entry.pickable && hit.id === entry.id) {
      out.push(...hit.layers);
      continue;
    }
    const layers = buildEntry(entry, atlas, opts);
    built.set(entry.data, { key, pickable: entry.pickable, id: entry.id, layers });
    out.push(...layers);
  }
  return out;
}

function buildEntry({ id, data, pickable }: LayerEntry, atlas: AtlasSnapshot, opts: BuildOptions): Layer[] {
  const out: Layer[] = [];
  {
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
      const cull = opts.cull;
      // a tube segment is kept when either end is in the box (segments are short next to the padding)
      const tubes = cull ? data.tubes.filter((t: MeshDatum) => inBox(t.position, cull) || inBox(tubeEnd(t), cull)) : data.tubes;
      out.push(...meshLayer(`${id}:tube`, tubes, m.cylinder, pickable));
      out.push(...meshLayer(`${id}:joint`, cull ? data.joints.filter((j: MeshDatum) => inBox(j.position, cull)) : data.joints, m.sphere, pickable));
      // catalog components replace their stand-in solids once the 3D models have loaded
      const models = componentModelsLoaded();
      const solids = data.solids.filter((s: SolidDatum) => (!models || !s.componentFallback) && inBox(s.position, cull));
      for (const shape of ['box', 'cylinder', 'sphere'] as const) {
        out.push(...meshLayer(`${id}:solid-${shape}`, solids.filter((s: SolidDatum) => s.shape === shape), m[shape], pickable));
      }
      out.push(...buildComponentLayers(id, cull ? data.components.filter((c: ComponentDatum) => inBox(c.position, cull)) : data.components, pickable));
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
    // flat symbols: always when the map is flat; with solids only while the 3D models are still loading
    if (!showSolids) out.push(...buildSymbolLayers(id, data.symbols, pickable));
    else if (!componentModelsLoaded()) {
      const covered = new Set(data.solids.filter((s: SolidDatum) => s.componentFallback).map((s) => s.fid));
      out.push(...buildSymbolLayers(id, data.symbols.filter((s) => !covered.has(s.fid)), pickable));
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

const M_PER_DEG = 111_320;
/** Far end of a tube segment (its matrix's first column is the segment vector in metres). */
function tubeEnd(t: MeshDatum): [number, number] {
  const p = t.position;
  return [p[0] + t.matrix[0]! / (Math.cos((p[1] * Math.PI) / 180) * M_PER_DEG), p[1] + t.matrix[1]! / M_PER_DEG];
}

/** 3D flow arrows: static instances, moved on the GPU by `time` (see FlowArrowLayer). */
export function buildFlowArrowLayer(arrows: ArrowInstance[], time: number): Layer[] {
  if (arrows.length === 0) return [];
  return [
    new FlowArrowLayer({
      id: 'wn-flow-arrow',
      data: arrows,
      mesh: meshes().arrow as never,
      flowTime: time,
      getPosition: (d: ArrowInstance) => d.position,
      getTransformMatrix: (d: ArrowInstance) => d.matrix,
      getColor: (d: ArrowInstance) => d.color,
      getFlow: (d: ArrowInstance) => d.flow,
      material: ARROW_MATERIAL as never,
      pickable: false,
      parameters: SOLID,
    } as never),
  ];
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
