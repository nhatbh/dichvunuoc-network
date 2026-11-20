/**
 * The component code list every service validates against (decision 0028: the component
 * catalog is the network asset model). This package is the authority for component codes:
 * `npm run codes` writes the list to @wn/contracts, the CAD import worker and the backend
 * building block `WaterPlatform.BuildingBlocks.Components`, and `codes.test.ts` fails when a
 * copy drifts.
 *
 * Per code: the GIS asset kind, where it attaches, what it does (functional flags consumers
 * test instead of type names), and the properties it may carry.
 */
import { CATALOG_ITEMS, type CatalogItem } from './catalog.js';

/** GIS asset kind. */
export type AssetKind = 'Node' | 'Pipe' | 'Device';
/** Where it sits: a pipe is a line; devices attach to a pipe or a node; nodes stand alone. */
export type CodeHost = 'line' | 'pipe' | 'node' | 'none';
/** What a component does. Consumers ask this, never the code. */
export type ComponentFunction =
  | 'isolates' // operable to close a pipe (isolation planning)
  | 'controls' // regulates pressure, flow or direction
  | 'meters' // measures volume through it
  | 'senses' // telemetry point
  | 'pumps' // adds head
  | 'fireFlow' // fire service outlet
  | 'stores' // storage volume
  | 'supplies' // water source into the network
  | 'connects' // fitting joining pipes
  | 'serves' // customer service
  | 'treats' // water treatment process equipment (mixing, settling, filtration, dosing, chlorination)
  | 'automates'; // electrical, control and supervision equipment (drives, PLC, HMI, SCADA)

export type PropertyType = 'int' | 'number' | 'string' | 'enum';
export interface PropertySpec {
  key: string;
  type: PropertyType;
  min?: number;
  max?: number;
  values?: readonly string[];
  unit?: string;
}

export interface CodeListEntry {
  code: string;
  name: string;
  vi: string;
  category: string;
  role: CatalogItem['role'];
  kind: AssetKind;
  host: CodeHost;
  functions: ComponentFunction[];
  defaultDN: number;
  dnRange: readonly [number, number];
  hasStatus: boolean;
  /** Properties an asset of this code may carry (validated by every service). */
  properties: PropertySpec[];
}

export const PIPE_MATERIAL_CODES = ['HDPE', 'PVC', 'DuctileIron', 'Steel', 'CastIron', 'Concrete'] as const;
export const CONDITIONS = ['good', 'fair', 'poor', 'critical'] as const;
export const VALVE_STATES = ['open', 'closed', 'throttled'] as const;

const ISOLATES = new Set(['GateValve', 'ButterflyValve', 'BallValve', 'ServiceValve', 'MotorisedValve']);
const CONTROLS = new Set(['CheckValve', 'PRV', 'PSV', 'FCV', 'AltitudeValve', 'BackflowPreventer', 'PRVStation', 'MotorisedValve']);
const SETPOINT = new Set(['PRV', 'PSV', 'FCV', 'AltitudeValve', 'PRVStation', 'MotorisedValve', 'DosingPump', 'Chlorinator', 'VFDPanel']);
const TELEMETRY = new Set(['TurbidityMeter', 'ChlorineAnalyser', 'PHAnalyser', 'DPTransmitter', 'GasDetector', 'CCTVCamera', 'MotorisedValve', 'DosingPump', 'Chlorinator', 'Blower']);
export const FIELDBUS_PROTOCOLS = ['ModbusTCP', 'ModbusRTU', 'Profinet', 'EtherNetIP', 'OPCUA', 'IEC104', 'MQTT'] as const;
const FUNCTIONS: Record<string, ComponentFunction[]> = {
  BulkMeter: ['meters', 'senses'],
  CustomerMeter: ['meters', 'serves'],
  ServiceConnection: ['serves'],
  ServiceValve: ['serves'],
  PressureSensor: ['senses'],
  LevelSensor: ['senses'],
  QualitySensor: ['senses'],
  AcousticLogger: ['senses'],
  RTU: ['senses'],
  Pump: ['pumps'],
  BoosterStation: ['pumps'],
  PumpStation: ['pumps'],
  Hydrant: ['fireFlow'],
  Reservoir: ['stores'],
  Tank: ['stores'],
  Source: ['supplies'],
  TurbidityMeter: ['senses'],
  ChlorineAnalyser: ['senses'],
  PHAnalyser: ['senses'],
  DPTransmitter: ['senses'],
  GasDetector: ['senses'],
  CCTVCamera: ['senses'],
  VerticalTurbinePump: ['pumps'],
  SubmersiblePump: ['pumps'],
  Blower: ['treats'],
  Mixer: ['treats'],
  Flocculator: ['treats'],
  LamellaSettler: ['treats'],
  RapidSandFilter: ['treats'],
  DosingPump: ['treats'],
  ChemicalTank: ['stores', 'treats'],
  Chlorinator: ['treats'],
  ChlorineContainer: ['stores', 'treats'],
  Scrubber: ['treats'],
  VFDPanel: ['automates'],
  MCC: ['automates'],
  PLCPanel: ['automates'],
  HMIPanel: ['automates'],
  SCADAWorkstation: ['automates'],
  Transformer: ['automates'],
};

const kindOf = (c: CatalogItem): AssetKind =>
  c.role === 'line' ? 'Pipe' : c.role === 'node' || c.role === 'facility' ? 'Node' : 'Device';
const hostOf = (c: CatalogItem): CodeHost =>
  c.role === 'line' ? 'line' : c.role === 'inline' ? 'pipe' : c.role === 'nodeDevice' ? 'node' : 'none';

function functionsOf(c: CatalogItem): ComponentFunction[] {
  const out = new Set<ComponentFunction>(FUNCTIONS[c.code] ?? []);
  if (ISOLATES.has(c.code)) out.add('isolates');
  if (CONTROLS.has(c.code)) out.add('controls');
  if (c.role === 'node') out.add('connects');
  return [...out];
}

function propertiesOf(c: CatalogItem, kind: AssetKind, functions: ComponentFunction[]): PropertySpec[] {
  const p: PropertySpec[] = [
    { key: 'dma', type: 'string' },
    { key: 'year', type: 'int', min: 1850, max: 2100 },
    { key: 'condition', type: 'enum', values: CONDITIONS },
    { key: 'manufacturer', type: 'string' },
    { key: 'model', type: 'string' },
    { key: 'serial', type: 'string' },
  ];
  // pipes keep diameter and material as their own fields (diameterMm, material)
  if (kind !== 'Pipe') p.push({ key: 'dn', type: 'int', min: c.dnRange[0], max: c.dnRange[1], unit: 'mm' });
  if (c.usesDN2) p.push({ key: 'dn2', type: 'int', min: c.dnRange[0], max: c.dnRange[1], unit: 'mm' });
  if (c.usesMaterial && kind !== 'Pipe') p.push({ key: 'material', type: 'enum', values: PIPE_MATERIAL_CODES });
  if (c.usesAngle) p.push({ key: 'angle', type: 'number', min: 0, max: 180, unit: '°' });
  if (kind === 'Node') p.push({ key: 'elevationM', type: 'number', min: -500, max: 9000, unit: 'm' });
  if (kind === 'Pipe') p.push({ key: 'depthM', type: 'number', min: 0, max: 50, unit: 'm' });
  if (functions.includes('isolates') || functions.includes('controls')) p.push({ key: 'state', type: 'enum', values: VALVE_STATES });
  if (SETPOINT.has(c.code)) p.push({ key: 'setpoint', type: 'number', min: 0, max: 200 });
  if (functions.includes('stores')) p.push({ key: 'capacityM3', type: 'number', min: 0, max: 1e7, unit: 'm³' });
  if (functions.includes('pumps')) p.push({ key: 'pumpCount', type: 'int', min: 1, max: 50 });
  // plant automation points carry their SCADA tag and how they are reached
  if (functions.includes('automates') || TELEMETRY.has(c.code)) {
    p.push({ key: 'tag', type: 'string' }, { key: 'protocol', type: 'enum', values: FIELDBUS_PROTOCOLS }, { key: 'ipAddress', type: 'string' });
  }
  return p;
}

export function catalogCodeList(): CodeListEntry[] {
  return CATALOG_ITEMS.map((c) => {
    const kind = kindOf(c);
    const functions = functionsOf(c);
    return {
      code: c.code,
      name: c.name,
      vi: c.vi,
      category: c.category,
      role: c.role,
      kind,
      host: hostOf(c),
      functions,
      defaultDN: c.defaultDN,
      dnRange: c.dnRange,
      hasStatus: c.hasStatus === true,
      properties: propertiesOf(c, kind, functions),
    };
  });
}
