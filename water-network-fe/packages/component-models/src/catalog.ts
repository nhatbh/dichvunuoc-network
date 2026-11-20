// Component catalog as plain data: codes, names, network role, ports and size ranges.
// No three.js dependency, so the editor, CAD import, 2D map and backend tooling can share it.
// Intended to move to packages/contracts once the codes are agreed with the backend.
import type { Category, Role } from './types.js';
export * from './types.js';

export interface CatalogItem {
  /** Stable code, used in GIS data and the backend. */
  code: string;
  name: string;
  /** Vietnamese name. */
  vi: string;
  category: Category;
  role: Role;
  /** Port ids in order; empty with `variablePorts` for plain junctions. */
  ports: readonly string[];
  variablePorts?: boolean;
  /** Ports whose DN is the second size (reducer outlet, tee branch, saddle outlet). */
  dn2Ports?: readonly string[];
  defaultDN: number;
  dnRange: readonly [number, number];
  /** Has a live-status part (sensor ring, hydrant band, meter LED). */
  hasStatus?: boolean;
  usesMaterial?: boolean;
  usesDN2?: boolean;
  usesAngle?: boolean;
}

const i = (code: string, name: string, vi: string, category: Category, role: Role, ports: string[], defaultDN: number, dnRange: [number, number], extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ code, name, vi, category, role, ports, defaultDN, dnRange, ...extra });

const AB = ['A', 'B'];

export const CATALOG_ITEMS: readonly CatalogItem[] = [
  i('Pipe', 'Pipe segment', 'Đoạn ống', 'Pipes', 'line', AB, 150, [20, 1200], { usesMaterial: true }),

  i('Junction', 'Plain junction', 'Điểm nối', 'Fittings', 'node', [], 150, [20, 1200], { variablePorts: true }),
  i('Tee', 'Tee', 'Tê đều', 'Fittings', 'node', ['A', 'B', 'C'], 150, [50, 1200], { usesMaterial: true }),
  i('ReducingTee', 'Reducing tee', 'Tê thu', 'Fittings', 'node', ['A', 'B', 'C'], 200, [80, 1200], { usesMaterial: true, usesDN2: true, dn2Ports: ['C'] }),
  i('Cross', 'Cross', 'Thập', 'Fittings', 'node', ['A', 'B', 'C', 'D'], 150, [50, 600], { usesMaterial: true }),
  i('Bend', 'Bend', 'Cút', 'Fittings', 'node', AB, 150, [50, 1200], { usesMaterial: true, usesAngle: true }),
  i('Reducer', 'Reducer', 'Côn thu', 'Fittings', 'node', AB, 200, [65, 1200], { usesMaterial: true, usesDN2: true, dn2Ports: ['B'] }),
  i('Cap', 'Cap / blind flange', 'Bịt đầu / mặt bích đặc', 'Fittings', 'node', ['A'], 150, [50, 1200], { usesMaterial: true }),
  i('Coupling', 'Coupling', 'Măng sông', 'Fittings', 'node', AB, 150, [50, 1200], { usesMaterial: true }),
  i('Transition', 'Flange adapter (PE to DI)', 'Khớp nối chuyển đổi', 'Fittings', 'node', AB, 150, [50, 800]),
  i('DismantlingJoint', 'Dismantling joint', 'Khớp nối tháo lắp', 'Fittings', 'node', AB, 300, [50, 1200]),
  i('ExpansionJoint', 'Expansion joint', 'Khớp co giãn', 'Fittings', 'node', AB, 200, [50, 1200]),
  i('TappingSaddle', 'Tapping saddle', 'Đai khởi thủy', 'Fittings', 'node', ['A', 'B', 'C'], 150, [80, 600], { usesMaterial: true, usesDN2: true, dn2Ports: ['C'] }),
  i('RepairClamp', 'Repair clamp', 'Đai sửa chữa', 'Fittings', 'node', AB, 150, [50, 600], { usesMaterial: true }),

  i('GateValve', 'Gate valve', 'Van cửa', 'Valves', 'inline', AB, 150, [50, 600]),
  i('ButterflyValve', 'Butterfly valve', 'Van bướm', 'Valves', 'inline', AB, 300, [150, 1200]),
  i('BallValve', 'Ball valve', 'Van bi', 'Valves', 'inline', AB, 50, [15, 150]),
  i('CheckValve', 'Check valve', 'Van một chiều', 'Valves', 'inline', AB, 150, [50, 600]),
  i('PRV', 'Pressure reducing valve', 'Van giảm áp', 'Valves', 'inline', AB, 150, [50, 600]),
  i('PSV', 'Pressure sustaining valve', 'Van duy trì áp', 'Valves', 'inline', AB, 150, [50, 600]),
  i('FCV', 'Flow control valve', 'Van điều tiết lưu lượng', 'Valves', 'inline', AB, 150, [50, 600]),
  i('AltitudeValve', 'Altitude valve', 'Van phao', 'Valves', 'inline', AB, 150, [50, 400]),
  i('AirValve', 'Air valve', 'Van xả khí', 'Valves', 'nodeDevice', ['A'], 80, [25, 200]),
  i('Washout', 'Washout valve', 'Van xả cặn', 'Valves', 'nodeDevice', ['A', 'Outlet'], 80, [50, 200]),
  i('BackflowPreventer', 'Backflow preventer', 'Thiết bị chống chảy ngược', 'Valves', 'inline', AB, 100, [20, 250]),

  i('Hydrant', 'Fire hydrant', 'Trụ cứu hỏa', 'Hydrants & services', 'nodeDevice', ['A'], 100, [80, 150], { hasStatus: true }),
  i('ServiceConnection', 'Service connection', 'Điểm đấu nối hộ dùng nước', 'Hydrants & services', 'nodeDevice', ['A', 'B', 'Service'], 150, [80, 400]),
  i('ServiceValve', 'Curb stop', 'Van trước đồng hồ', 'Hydrants & services', 'inline', AB, 25, [15, 50]),
  i('CustomerMeter', 'Customer meter', 'Đồng hồ nước khách hàng', 'Hydrants & services', 'nodeDevice', AB, 20, [15, 50]),
  i('SamplingPoint', 'Sampling point', 'Điểm lấy mẫu', 'Hydrants & services', 'nodeDevice', ['A'], 20, [15, 25]),

  i('BulkMeter', 'Bulk / DMA flow meter', 'Đồng hồ tổng / DMA', 'Metering & monitoring', 'inline', AB, 200, [50, 1200], { hasStatus: true }),
  i('PressureSensor', 'Pressure logger', 'Thiết bị đo áp lực', 'Metering & monitoring', 'nodeDevice', ['A'], 15, [15, 15], { hasStatus: true }),
  i('LevelSensor', 'Level sensor', 'Cảm biến mực nước', 'Metering & monitoring', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('QualitySensor', 'Water quality analyser', 'Thiết bị đo chất lượng nước', 'Metering & monitoring', 'nodeDevice', ['A'], 15, [15, 15], { hasStatus: true }),
  i('AcousticLogger', 'Acoustic leak logger', 'Thiết bị nghe rò rỉ', 'Metering & monitoring', 'nodeDevice', ['A'], 15, [15, 15], { hasStatus: true }),
  i('RTU', 'RTU / telemetry gateway', 'Thiết bị thu thập dữ liệu', 'Metering & monitoring', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),

  i('Pump', 'Pump set', 'Máy bơm', 'Pumping & storage', 'inline', ['Suction', 'Discharge'], 150, [50, 600]),
  i('BoosterStation', 'Booster skid', 'Trạm bơm tăng áp', 'Pumping & storage', 'facility', ['Suction', 'Discharge'], 150, [80, 300], { hasStatus: true }),
  i('PRVStation', 'PRV station', 'Trạm giảm áp', 'Pumping & storage', 'facility', AB, 150, [80, 400]),
  i('ChlorinationPoint', 'Re-chlorination point', 'Trạm châm clo bổ sung', 'Pumping & storage', 'nodeDevice', AB, 200, [100, 600], { hasStatus: true }),
  i('Strainer', 'Y-strainer', 'Lọc Y', 'Pumping & storage', 'inline', AB, 150, [50, 400]),
  i('PumpStation', 'Pump station', 'Trạm bơm', 'Pumping & storage', 'facility', ['Suction', 'Discharge'], 300, [150, 1200]),
  i('Reservoir', 'Clear-water reservoir', 'Bể chứa nước sạch', 'Pumping & storage', 'facility', ['Inlet', 'Outlet'], 400, [200, 1200]),
  i('Tank', 'Elevated tank', 'Đài nước', 'Pumping & storage', 'facility', ['A'], 300, [150, 800]),
  i('Source', 'Treatment plant outlet', 'Nhà máy nước', 'Pumping & storage', 'facility', ['Outlet'], 600, [300, 1200]),

  // ---- what a clean-water plant monitors and controls (src/plant.ts) ----
  i('TurbidityMeter', 'Online turbidimeter', 'Máy đo độ đục trực tuyến', 'Metering & monitoring', 'nodeDevice', ['A'], 15, [15, 15], { hasStatus: true }),
  i('ChlorineAnalyser', 'Residual chlorine analyser', 'Máy đo clo dư trực tuyến', 'Metering & monitoring', 'nodeDevice', ['A'], 15, [15, 15], { hasStatus: true }),
  i('PHAnalyser', 'pH / ORP analyser', 'Máy đo pH / ORP', 'Metering & monitoring', 'nodeDevice', ['A'], 15, [15, 15], { hasStatus: true }),
  i('DPTransmitter', 'Differential pressure transmitter', 'Cảm biến chênh áp', 'Metering & monitoring', 'nodeDevice', ['High', 'Low'], 15, [15, 15], { hasStatus: true }),
  i('GasDetector', 'Chlorine gas detector', 'Đầu dò rò rỉ khí clo', 'Metering & monitoring', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('CCTVCamera', 'CCTV camera', 'Camera giám sát', 'Metering & monitoring', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),

  i('MotorisedValve', 'Motorised butterfly valve', 'Van bướm điều khiển điện', 'Valves', 'inline', AB, 300, [100, 1200], { hasStatus: true }),
  i('VerticalTurbinePump', 'Vertical turbine pump', 'Bơm trục đứng', 'Pumping & storage', 'inline', ['Suction', 'Discharge'], 400, [150, 800]),
  i('SubmersiblePump', 'Submersible pump', 'Bơm chìm', 'Pumping & storage', 'nodeDevice', ['Discharge'], 150, [50, 400]),
  i('Blower', 'Air blower', 'Máy thổi khí', 'Treatment', 'nodeDevice', ['Outlet'], 300, [80, 600], { hasStatus: true }),

  i('Mixer', 'Rapid mixer', 'Máy khuấy trộn nhanh', 'Treatment', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('Flocculator', 'Paddle flocculator', 'Máy khuấy phản ứng (bông cặn)', 'Treatment', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('LamellaSettler', 'Lamella settler', 'Bể lắng lamella', 'Treatment', 'facility', ['Inlet', 'Outlet'], 600, [300, 1200]),
  i('RapidSandFilter', 'Rapid sand filter', 'Bể lọc nhanh', 'Treatment', 'facility', ['Inlet', 'Outlet'], 400, [200, 800]),
  i('DosingPump', 'Chemical dosing pump', 'Bơm định lượng hóa chất', 'Treatment', 'inline', ['Suction', 'Discharge'], 25, [15, 50], { hasStatus: true }),
  i('ChemicalTank', 'Chemical preparation tank', 'Bồn pha hóa chất', 'Treatment', 'nodeDevice', ['Outlet'], 50, [25, 100], { hasStatus: true }),
  i('Chlorinator', 'Gas chlorinator', 'Clorator (thiết bị châm clo khí)', 'Treatment', 'nodeDevice', ['Outlet'], 25, [15, 50], { hasStatus: true }),
  i('ChlorineContainer', 'Chlorine container 900 kg', 'Bình clo lỏng 900 kg', 'Treatment', 'nodeDevice', ['Outlet'], 15, [15, 25]),
  i('Scrubber', 'Chlorine scrubber', 'Tháp trung hòa khí clo', 'Treatment', 'facility', ['Inlet'], 200, [100, 400], { hasStatus: true }),

  i('VFDPanel', 'Variable frequency drive', 'Tủ biến tần', 'Electrical & automation', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('MCC', 'Motor control centre', 'Tủ điều khiển động cơ (MCC)', 'Electrical & automation', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('PLCPanel', 'PLC control panel', 'Tủ điều khiển PLC', 'Electrical & automation', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('HMIPanel', 'Local HMI operator panel', 'Màn hình vận hành tại chỗ (HMI)', 'Electrical & automation', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('SCADAWorkstation', 'SCADA operator workstation', 'Trạm vận hành SCADA', 'Electrical & automation', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
  i('Transformer', 'Distribution transformer', 'Máy biến áp', 'Electrical & automation', 'nodeDevice', ['Mount'], 15, [15, 15], { hasStatus: true }),
];

export type ComponentCode = (typeof CATALOG_ITEMS)[number]['code'];
const BY_CODE = new Map(CATALOG_ITEMS.map((c) => [c.code, c]));
export const getCatalogItem = (code: string): CatalogItem | undefined => BY_CODE.get(code);
export const COMPONENT_CODES: readonly string[] = CATALOG_ITEMS.map((c) => c.code);

/** Clamp a DN into the component's supported range. */
export function clampDN(code: string, dn?: number): number {
  const c = BY_CODE.get(code);
  if (!c) throw new Error(`Unknown component code "${code}"`);
  const v = dn ?? c.defaultDN;
  return Math.min(c.dnRange[1], Math.max(c.dnRange[0], v));
}
