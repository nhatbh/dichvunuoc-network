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

export interface CodeListEntry {
  code: string;
  name: string;
  vi: string;
  category: string;
  role: CatalogItem['role'];
  host: CodeHost;
  /** gis-be device type until it accepts every code; null = not a gis-be device. */
  gisDeviceType: GisDeviceType | null;
  defaultDN: number;
  dnRange: readonly [number, number];
  hasStatus: boolean;
}

const VALVES = new Set([
  'GateValve', 'ButterflyValve', 'BallValve', 'CheckValve', 'PRV', 'PSV', 'FCV', 'AltitudeValve',
  'BackflowPreventer', 'ServiceValve',
]);

const gisDeviceType = (code: string): GisDeviceType | null => {
  if (VALVES.has(code)) return 'Valve';
  if (code === 'BulkMeter') return 'FlowMeter';
  if (code === 'PressureSensor' || code === 'Pump' || code === 'Hydrant') return code;
  return null;
};

const hostOf = (c: CatalogItem): CodeHost => (c.role === 'line' ? 'line' : c.role === 'inline' ? 'pipe' : 'node');

export function catalogCodeList(): CodeListEntry[] {
  return CATALOG_ITEMS.map((c) => ({
    code: c.code,
    name: c.name,
    vi: c.vi,
    category: c.category,
    role: c.role,
    host: hostOf(c),
    gisDeviceType: gisDeviceType(c.code),
    defaultDN: c.defaultDN,
    dnRange: c.dnRange,
    hasStatus: c.hasStatus === true,
  }));
}
