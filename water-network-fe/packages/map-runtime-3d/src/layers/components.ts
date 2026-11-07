/**
 * Catalog components (`style.component`) from @wn/component-models.
 *
 * Flat symbols come from the light `/symbols` entry and are always available. The 3D models
 * come from `/deck`, which pulls in three.js for geometry generation, so it is loaded on
 * first use (when solids are shown) and the existing `solid` shapes stand in until then.
 */
import { IconLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import type { Layer } from '@deck.gl/core';
import { getCatalogItem } from '@wn/component-models/catalog';
import { getSymbol, mapSymbolSVG } from '@wn/component-models/symbols';
import type { ComponentDatum, SymbolDatum } from './prepare-layer.js';

type DeckModels = typeof import('@wn/component-models/deck');

let models: DeckModels | null = null;
let loading: Promise<DeckModels> | null = null;

/** True once the 3D component models are available (synchronously usable by `buildComponentLayers`). */
export const componentModelsLoaded = (): boolean => models !== null;

/** Load the 3D component models once; resolves immediately when already loaded. */
export function loadComponentModels(): Promise<DeckModels> {
  if (models) return Promise.resolve(models);
  loading ??= import('@wn/component-models/deck').then((m) => {
    models = m;
    return m;
  });
  return loading;
}

/** Test hook: install (or clear) the model module without a dynamic import. */
export function setComponentModelsForTesting(m: DeckModels | null): void {
  models = m;
  loading = m ? Promise.resolve(m) : null;
}

const FLAT = { depthCompare: 'always', depthWriteEnabled: false } as const;
const SOLID = { depthCompare: 'less-equal', depthWriteEnabled: true } as const;
const MESH_MATERIAL = { ambient: 0.45, diffuse: 0.7, shininess: 40, specularColor: [90, 96, 104] } as const;

/** Status ring / band colours (same as the symbols). */
export const STATUS_RGB: Record<NonNullable<ComponentDatum['status']>, [number, number, number]> = {
  normal: [47, 179, 107],
  warning: [229, 160, 13],
  critical: [224, 69, 58],
  offline: [125, 131, 138],
};
const NO_STATUS: [number, number, number] = [205, 210, 214];

// ---------- flat symbols ----------
interface IconDef { id: string; url: string; width: number; height: number; mask: false }
const icons = new Map<string, IconDef>();
const ICON_PX = 64;
function iconFor(code: string, status: SymbolDatum['status']): IconDef {
  // any component may carry a state ring (e.g. a closed valve); live sensors use it for their reading
  const showStatus = !!status;
  const id = `${code}|${showStatus ? status : ''}`;
  let def = icons.get(id);
  if (!def) {
    // map style: in-line parts drawn into the pipe, point assets as compact badges (not round icons)
    const svg = mapSymbolSVG(code, { size: ICON_PX, status: showStatus ? status : undefined });
    def = { id, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: ICON_PX, height: ICON_PX, mask: false };
    icons.set(id, def);
  }
  return def;
}

/** Symbols that follow their pipe lie flat and turn with it; the others face the camera. */
export function buildSymbolLayers(id: string, symbols: SymbolDatum[], pickable: boolean): Layer[] {
  if (symbols.length === 0) return [];
  const aligned = symbols.filter((s) => getSymbol(s.code).align === 'pipe');
  const upright = symbols.filter((s) => getSymbol(s.code).align !== 'pipe');
  const common = {
    getIcon: (d: SymbolDatum) => iconFor(d.code, d.status),
    getPosition: (d: SymbolDatum) => d.position,
    getSize: (d: SymbolDatum) => d.size,
    getColor: (d: SymbolDatum) => [255, 255, 255, Math.round(255 * d.opacity)],
    sizeUnits: 'pixels' as const,
    pickable,
    parameters: FLAT,
  };
  const out: Layer[] = [];
  if (aligned.length) {
    out.push(new IconLayer<SymbolDatum>({ ...common, id: `${id}:sym-pipe`, data: aligned, billboard: false, getAngle: (d: SymbolDatum) => d.angle } as never));
  }
  if (upright.length) out.push(new IconLayer<SymbolDatum>({ ...common, id: `${id}:sym`, data: upright, billboard: true } as never));
  return out;
}

// ---------- 3D models ----------
/** Height of the model's pipe axis above its anchor, so in-line devices sit on the tube (tubes rest on the ground). */
function axisLift(d: ComponentDatum): number {
  const item = getCatalogItem(d.code);
  if (!item || (item.role !== 'inline' && item.role !== 'node' && item.role !== 'line')) return 0;
  const dn = d.dn ?? item.defaultDN;
  return ((Math.max(dn, 25) / 1000) * d.scale) / 2;
}

/** One SimpleMeshLayer per (code, DN, material) for the body, plus one for status parts. Empty until the models load. */
export function buildComponentLayers(id: string, data: ComponentDatum[], pickable: boolean, segments = 12): Layer[] {
  if (!models || data.length === 0) return [];
  const m = models;
  const groups = new Map<string, ComponentDatum[]>();
  for (const d of data) {
    if (!getCatalogItem(d.code)) continue;
    const k = `${d.code}|${d.dn ?? ''}|${d.material ?? ''}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }
  const out: Layer[] = [];
  for (const [k, group] of groups) {
    const first = group[0]!;
    const mesh = m.componentMesh(first.code, { dn: first.dn, material: first.material as never, segments });
    const common = {
      data: group,
      getPosition: (d: ComponentDatum) => [d.position[0], d.position[1], d.position[2] + axisLift(d)],
      getTransformMatrix: (d: ComponentDatum) => m.headingMatrix(d.bearing, d.scale),
      material: MESH_MATERIAL,
      pickable,
      parameters: SOLID,
    };
    out.push(new SimpleMeshLayer<ComponentDatum>({ ...common, id: `${id}:cm:${k}`, mesh: mesh.body, getColor: (d: ComponentDatum) => d.color } as never));
    if (mesh.status) {
      out.push(
        new SimpleMeshLayer<ComponentDatum>({
          ...common,
          id: `${id}:cm-status:${k}`,
          mesh: mesh.status,
          getColor: (d: ComponentDatum) => [...(d.status ? STATUS_RGB[d.status] : NO_STATUS), d.color[3] ?? 255],
        } as never),
      );
    }
  }
  return out;
}
