import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { StyleSpec } from '@wn/map-runtime';
import { parseColor, type RGBA } from '../core/color.js';
import { densifyLine, lineMidpoint, ringCentroid } from '../core/geo-math.js';
import { resolveFeatureStyle } from '../core/style-resolve.js';
import type { FeatureStyle3D } from '../port/map-engine-3d-port.js';
import type { IconAtlas } from './icon-atlas.js';
import { buildFlow, type FlowDatum } from './flow.js';
import { alongMatrix, angleBetween, enuDelta, scaleMatrix, vecLen, type V3 } from '../core/tube-math.js';

export type Pos3 = [number, number, number];

export interface LineDatum {
  fid: string;
  path: Pos3[];
  color: RGBA;
  /** Width in CSS px. */
  width: number;
  /** [dash, gap] in px, if dashed. */
  dash?: [number, number];
  /** Also drawn as a 3D tube: the flat stroke is hidden while tubes are shown. */
  tubed?: boolean;
}
export interface PolyDatum {
  fid: string;
  polygon: Pos3[][];
  fill: RGBA;
  /** Extrusion height in metres (0 = flat). */
  height: number;
}
export interface PointDatum {
  fid: string;
  position: Pos3;
  iconKey: string;
  iconSize: number;
  /** Also drawn as a 3D solid: the flat icon is hidden while solids are shown. */
  solid?: boolean;
}
export interface RingDatum {
  fid: string;
  position: Pos3;
  radius: number;
  color: RGBA;
  width: number;
}
export interface TextDatum {
  fid: string;
  position: Pos3;
  text: string;
  color: RGBA;
  size: number;
  family: string;
  offsetY: number;
  outline?: RGBA;
  outlineWidth: number;
}
export interface ColumnDatum {
  fid: string;
  position: Pos3;
  height: number;
  radius: number;
  sides: number;
  color: RGBA;
}

/** One mesh instance: anchor position + 4x4 column-major transform in metres. */
export interface MeshDatum {
  fid: string;
  position: Pos3;
  matrix: number[];
  color: RGBA;
}
export interface SolidDatum extends MeshDatum {
  shape: 'box' | 'cylinder' | 'sphere';
}

export interface PreparedLayer {
  /** Tube segments + flanges (cylinders along +X) and bend joints (spheres). */
  tubes: MeshDatum[];
  joints: MeshDatum[];
  solids: SolidDatum[];
  flows: FlowDatum[];
  halos: LineDatum[];
  lines: LineDatum[];
  polygons: PolyDatum[];
  pointHalos: RingDatum[];
  points: PointDatum[];
  texts: TextDatum[];
  columns: ColumnDatum[];
}

export interface PrepareContext {
  selectedId: string | null;
  /** Geometry overrides (live edit preview) keyed by feature id. */
  preview: ReadonlyMap<string, Geometry>;
  isDraft: boolean;
  atlas: IconAtlas;
  /** Ground elevation (m, exaggerated) at lon/lat; null = flat map. */
  groundZ: ((lon: number, lat: number) => number | null) | null;
}

const TERRAIN_STEP_M = 30;
const MAX_DENSIFIED_VERTICES = 80_000;

export const featureId = (f: Feature): string | null => (f.id === undefined || f.id === null ? null : String(f.id));

const FONT_RE = /(\d+(?:\.\d+)?)px\s+(.+)$/;
function parseFont(font: string | undefined): { size: number; family: string } {
  const m = font?.match(FONT_RE);
  return { size: m ? parseFloat(m[1]!) : 12, family: m ? m[2]!.replace(/^["']|["']$/g, '') : 'sans-serif' };
}

export function emptyPrepared(): PreparedLayer {
  return { tubes: [], joints: [], solids: [], flows: [], halos: [], lines: [], polygons: [], pointHalos: [], points: [], texts: [], columns: [] };
}

function dashPx(dash: number[] | undefined): [number, number] | undefined {
  if (!dash || dash.length === 0) return undefined;
  const on = Math.max(0.5, dash[0] ?? 4);
  const off = Math.max(0.5, dash[1] ?? dash[0] ?? 4);
  return [on, off];
}

export function prepareLayer(
  collection: FeatureCollection,
  spec: StyleSpec | undefined,
  ctx: PrepareContext,
): PreparedLayer {
  const out = emptyPrepared();
  let budget = MAX_DENSIFIED_VERTICES;
  for (const feature of collection.features) {
    const fid = featureId(feature);
    const geometry = (fid != null ? ctx.preview.get(fid) : undefined) ?? feature.geometry;
    if (!geometry) continue;
    const selected = fid != null && fid === ctx.selectedId;
    const style = resolveFeatureStyle(spec, (feature.properties ?? {}) as Record<string, unknown>, selected, ctx.isDraft);
    budget = addGeometry(out, fid ?? '', geometry, style, ctx, feature.properties ?? {}, budget);
  }
  return out;
}

function lift(ctx: PrepareContext, p: Position, elevation: number): Pos3 {
  const g = ctx.groundZ ? (ctx.groundZ(p[0]!, p[1]!) ?? 0) : 0;
  return [p[0]!, p[1]!, g + elevation + (p[2] ?? 0)];
}

function addGeometry(
  out: PreparedLayer,
  fid: string,
  geometry: Geometry,
  style: FeatureStyle3D,
  ctx: PrepareContext,
  _props: Record<string, unknown>,
  budget: number,
): number {
  const op = style.opacity ?? 1;
  const elevation = style.elevation ?? 0;
  switch (geometry.type) {
    case 'Point':
      addPoint(out, fid, geometry.coordinates, style, ctx, op, elevation);
      return budget;
    case 'MultiPoint':
      for (const c of geometry.coordinates) addPoint(out, fid, c, style, ctx, op, elevation);
      return budget;
    case 'LineString':
      return addLine(out, fid, geometry.coordinates, style, ctx, op, elevation, budget, true);
    case 'MultiLineString': {
      let b = budget;
      geometry.coordinates.forEach((line, i) => {
        b = addLine(out, fid, line, style, ctx, op, elevation, b, i === 0);
      });
      return b;
    }
    case 'Polygon':
      return addPolygon(out, fid, geometry.coordinates, style, ctx, op, elevation, budget);
    case 'MultiPolygon': {
      let b = budget;
      for (const poly of geometry.coordinates) b = addPolygon(out, fid, poly, style, ctx, op, elevation, b);
      return b;
    }
    case 'GeometryCollection': {
      let b = budget;
      for (const g of geometry.geometries) b = addGeometry(out, fid, g, style, ctx, _props, b);
      return b;
    }
  }
}

function addPoint(out: PreparedLayer, fid: string, c: Position, style: FeatureStyle3D, ctx: PrepareContext, op: number, elevation: number): void {
  const position = lift(ctx, c, elevation);
  const im = style.image;
  if (im) {
    const { key, entry } = ctx.atlas.get(im, op);
    out.points.push({ fid, position, iconKey: key, iconSize: entry.size, solid: !!style.solid });
  }
  if (style.solid) {
    const [w, d, h] = style.solid.size;
    const color = parseColor(style.solid.color ?? im?.color ?? '#64748b', op);
    const shape = style.solid.shape;
    const matrix =
      shape === 'sphere' ? scaleMatrix(w / 2, d / 2, h / 2) : shape === 'cylinder' ? alongMatrix([0, 0, h], w / 2) : scaleMatrix(w, d, h);
    const anchor: Pos3 = shape === 'sphere' ? [position[0], position[1], position[2] + h / 2] : position;
    out.solids.push({ fid, position: anchor, matrix, color, shape });
  }
  if (style.halo) {
    const w = style.halo.width ?? 2;
    out.pointHalos.push({
      fid,
      position,
      radius: (im ? im.radius + (im.strokeWidth ?? 1) / 2 : 5) + w / 2 + 1,
      color: parseColor(style.halo.color, op),
      width: w,
    });
  }
  if (style.extrude) {
    out.columns.push({
      fid,
      position,
      height: style.extrude.height,
      radius: style.extrude.radius ?? 3,
      sides: style.extrude.sides ?? 16,
      color: parseColor(style.extrude.color ?? im?.color ?? style.fill ?? '#64748b', op),
    });
  }
  addText(out, fid, [position[0], position[1]], position[2], style, op);
}

function addText(out: PreparedLayer, fid: string, at: [number, number], z: number, style: FeatureStyle3D, op: number): void {
  const t = style.text;
  if (!t || !t.value) return;
  const f = parseFont(t.font);
  out.texts.push({
    fid,
    position: [at[0], at[1], z],
    text: t.value,
    color: parseColor(t.color ?? '#0f172a', op),
    size: f.size,
    family: f.family,
    offsetY: t.offsetY ?? 0,
    outline: t.stroke ? parseColor(t.stroke, op) : undefined,
    outlineWidth: t.strokeWidth ?? 2,
  });
}

function toPath(ctx: PrepareContext, coords: Position[], elevation: number, budget: number): { path: Pos3[]; budget: number } {
  let src: ReadonlyArray<readonly number[]> = coords;
  if (ctx.groundZ && budget > 0) {
    const dense = densifyLine(coords, TERRAIN_STEP_M);
    if (dense.length <= budget) {
      src = dense;
      budget -= dense.length;
    }
  }
  return { path: src.map((p) => lift(ctx, p as Position, elevation)), budget };
}

function addLine(
  out: PreparedLayer,
  fid: string,
  coords: Position[],
  style: FeatureStyle3D,
  ctx: PrepareContext,
  op: number,
  elevation: number,
  budget: number,
  label: boolean,
): number {
  if (coords.length < 2) return budget;
  const { path, budget: left } = toPath(ctx, coords, elevation, budget);
  if (style.halo) {
    out.halos.push({ fid, path, color: parseColor(style.halo.color, op), width: style.halo.width ?? 2, dash: dashPx(style.halo.dash) });
  }
  if (style.stroke) {
    out.lines.push({ fid, path, color: parseColor(style.stroke.color, op), width: style.stroke.width ?? 2, dash: dashPx(style.stroke.dash), tubed: !!style.tube });
  }
  if (style.tube) addTube(out, fid, path, style, op);
  if (style.flow) {
    const tubeR = style.tube ? Math.max(style.tube.diameterM, 0.02) / 2 : 0;
    const f = buildFlow(fid, path, style.flow.speedMps, style.flow.direction, parseColor(style.flow.color ?? '#9be7ff', op), tubeR, style.stroke?.width ?? 3);
    if (f) out.flows.push(f);
  }
  if (label && style.text?.value) {
    const mid = lineMidpoint(coords);
    if (mid) addText(out, fid, mid, ctx.groundZ ? (ctx.groundZ(mid[0], mid[1]) ?? 0) + elevation : elevation, style, op);
  }
  return left;
}

function addPolygon(
  out: PreparedLayer,
  fid: string,
  rings: Position[][],
  style: FeatureStyle3D,
  ctx: PrepareContext,
  op: number,
  elevation: number,
  budget: number,
): number {
  if (rings.length === 0) return budget;
  let b = budget;
  const polygon: Pos3[][] = rings.map((ring) => {
    const r = toPath(ctx, ring, elevation, b);
    b = r.budget;
    return r.path;
  });
  const extrude = style.extrude?.height ?? 0;
  const fill = style.fill ?? (extrude > 0 ? style.extrude?.color : undefined);
  if (fill || extrude > 0) {
    out.polygons.push({ fid, polygon, fill: parseColor(style.extrude?.color ?? fill, op), height: extrude });
  }
  if (style.halo) {
    for (const ring of polygon) out.halos.push({ fid, path: ring, color: parseColor(style.halo.color, op), width: style.halo.width ?? 2, dash: dashPx(style.halo.dash) });
  }
  if (style.stroke) {
    for (const ring of polygon) out.lines.push({ fid, path: ring, color: parseColor(style.stroke.color, op), width: style.stroke.width ?? 2, dash: dashPx(style.stroke.dash) });
  }
  const c = ringCentroid(rings[0]!);
  if (c) addText(out, fid, c, ctx.groundZ ? (ctx.groundZ(c[0], c[1]) ?? 0) + elevation : elevation, style, op);
  return b;
}

const BEND_JOINT_DEG = 10;

/** Cylinder segments along the path (resting on the ground), flange connectors at both ends, spheres at bends. */
function addTube(out: PreparedLayer, fid: string, path: Pos3[], style: FeatureStyle3D, op: number): void {
  const tube = style.tube!;
  const radius = Math.max(tube.diameterM, 0.02) / 2;
  const color = parseColor(tube.color ?? style.stroke?.color ?? '#0e7c86', op);
  const fitting = parseColor(tube.fittingColor ?? '#475569', op);
  const pts: Pos3[] = path.map((p) => [p[0], p[1], p[2] + radius]);
  const dirs: V3[] = [];
  for (let i = 1; i < pts.length; i++) {
    const v = enuDelta(pts[i - 1]!, pts[i]!);
    if (vecLen(v) < 1e-3) continue;
    out.tubes.push({ fid, position: pts[i - 1]!, matrix: alongMatrix(v, radius), color });
    dirs.push(v);
    if (dirs.length > 1 && angleBetween(dirs[dirs.length - 2]!, v) > BEND_JOINT_DEG) {
      out.joints.push({ fid, position: pts[i - 1]!, matrix: scaleMatrix(radius * 1.02, radius * 1.02, radius * 1.02), color });
    }
  }
  if (dirs.length === 0) return;
  const flangeLen = Math.max(radius * 1.2, 0.15);
  const flangeR = radius * 1.4;
  const first = dirs[0]!;
  const last = dirs[dirs.length - 1]!;
  const scale = (v: V3, l: number): V3 => {
    const n = vecLen(v) || 1;
    return [(v[0] / n) * l, (v[1] / n) * l, (v[2] / n) * l];
  };
  out.tubes.push({ fid, position: pts[0]!, matrix: alongMatrix(scale(first, flangeLen), flangeR), color: fitting });
  const end = pts[pts.length - 1]!;
  const back = scale(last, -flangeLen);
  // anchor the end flange one flange-length before the end point, pointing along the pipe
  const lat = end[1] * (Math.PI / 180);
  const anchor: Pos3 = [end[0] + back[0] / (Math.cos(lat) * 111_320), end[1] + back[1] / 111_320, end[2] + back[2]];
  out.tubes.push({ fid, position: anchor, matrix: alongMatrix(scale(last, flangeLen), flangeR), color: fitting });
}
