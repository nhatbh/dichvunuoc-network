/**
 * The component code list the platform validates against. This package is the authority for
 * component codes (integration plan, decision 7): `npm run codes` writes this list to
 * `packages/contracts/src/catalog/codes.json`, which gis-be and design-be validate against, and
 * `codes.test.ts` fails when the two drift apart.
 */
import { CATALOG_ITEMS, type CatalogItem } from './catalog.js';

/** Where a component sits in the GIS model. */
export type CodeHost = 'line' | 'pipe' | 'node';

/** The five device types gis-be accepts today; codes without one are stored as nodes or pipes. */
export type GisDeviceType = 'Valve' | 'FlowMeter' | 'PressureSensor' | 'Pump' | 'Hydrant';
/** gis-be node types. */
export type GisNodeType = 'Junction' | 'Reservoir' | 'Tank' | 'Hydrant' | 'Other';
/** How gis-be stores a component until it accepts every code: as a pipe, a node or a device. */
export type GisKind = 'Pipe' | 'Node' | 'Device';

export interface CodeListEntry {
  code: string;
  name: string;
  vi: string;
  category: string;
  role: CatalogItem['role'];
  host: CodeHost;
  /** How gis-be stores it today (the component code travels along as the `componentCode` attribute). */
  gisKind: GisKind;
  /** gis-be device type when stored as a device; null otherwise. */
  gisDeviceType: GisDeviceType | null;
  /** gis-be node type when stored as a node; null otherwise. */
  gisNodeType: GisNodeType | null;
  defaultDN: number;
  dnRange: readonly [number, number];
  hasStatus: boolean;
}

const VALVES = new Set([
  'GateValve',
  'ButterflyValve',
  'BallValve',
  'CheckValve',
  'PRV',
  'PSV',
  'FCV',
  'AltitudeValve',
  'BackflowPreventer',
  'ServiceValve',
]);

const gisDeviceType = (code: string): GisDeviceType | null => {
  if (VALVES.has(code)) return 'Valve';
  if (code === 'BulkMeter') return 'FlowMeter';
  if (code === 'PressureSensor' || code === 'Pump' || code === 'Hydrant') return code;
  return null;
};

/** gis-be's host rule for its device types (DeviceHost): valves and meters on a pipe, pumps and hydrants on a node. */
const DEVICE_HOST: Record<GisDeviceType, CodeHost> = {
  Valve: 'pipe',
  FlowMeter: 'pipe',
  Pump: 'node',
  Hydrant: 'node',
  PressureSensor: 'node',
};

const gisNodeType = (c: CatalogItem): GisNodeType => {
  if (c.code === 'Reservoir' || c.code === 'Source') return 'Reservoir';
  if (c.code === 'Tank') return 'Tank';
  if (c.role === 'node') return 'Junction'; // fittings
  return 'Other'; // facilities and devices gis-be has no device type for yet
};

const hostOf = (c: CatalogItem, device: GisDeviceType | null): CodeHost =>
  c.role === 'line' ? 'line' : device ? DEVICE_HOST[device] : 'node';

export function catalogCodeList(): CodeListEntry[] {
  return CATALOG_ITEMS.map((c) => {
    const device = gisDeviceType(c.code);
    const kind: GisKind = c.role === 'line' ? 'Pipe' : device ? 'Device' : 'Node';
    return {
      code: c.code,
      name: c.name,
      vi: c.vi,
      category: c.category,
      role: c.role,
      host: hostOf(c, device),
      gisKind: kind,
      gisDeviceType: device,
      gisNodeType: kind === 'Node' ? gisNodeType(c) : null,
      defaultDN: c.defaultDN,
      dnRange: c.dnRange,
      hasStatus: c.hasStatus === true,
    };
  });
}
