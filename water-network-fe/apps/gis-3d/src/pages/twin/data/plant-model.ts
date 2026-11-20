/**
 * The Sông Hồng clean-water plant (29,000 m³/ngđ) and the river intake TB1, as the demo draws and simulates them.
 *
 * From the drawings (`cad-twin.json`, see scripts/twin/extract_cad_twin.py):
 *   site boundary, every structure outline and its legend name, the treatment-train cells (12 flocculation
 *   cells, 2 lamella settlers, 4 filter beds), the raw-water pond, internal roads, trees, gate and guard house,
 *   and the geo-reference (Xref of the VN-2000 survey).
 * From the process drawings (DCCN, TB1, TB chuyển tiếp, TB2, Nhà clo + hóa chất, Cụm bể trộn – lắng):
 *   pump duties (TB1 Q=1450 m³/h H=45 m · chuyển tiếp Q=750 m³/h H=20 m · nước sạch Q=850 m³/h H=50 m ·
 *   rửa lọc Q=1050 m³/h H=15 m), máy gió 75 m³/ph, máy khuấy 3 bậc 1 kW (14/12/8 v/ph), bình clo 900 kg,
 *   PAC 17 %, ống ra D1000 thép.
 * Assumed for the demo (marked `assumed`): heights, the equipment's exact place inside each building,
 * how many units run, and the instrument tags.
 */
import cad from './cad-twin.json'
import { rotate, toLocal, type XY } from './geo'

export type StructureKind =
  | 'pond'
  | 'transfer_ps'
  | 'clarifier'
  | 'filters'
  | 'reservoir'
  | 'clean_ps'
  | 'backwash_ps'
  | 'chemical'
  | 'chlorine'
  | 'recovery'
  | 'sludge'
  | 'substation'
  | 'admin'
  | 'guard'
  | 'parking'

export interface Structure {
  id: string
  no: number
  name: string
  kind: StructureKind
  /** plant frame (drawing axes), metres around the site centre */
  poly: XY[]
  fromDrawing: boolean
  /** wall / roof height above ground (m) — assumed */
  height: number
  /** water surface below the wall top (m), for open basins */
  water?: number
  color: number
  roof: 'open' | 'flat' | 'covered' | 'none'
}

const STYLE: Record<StructureKind, { height: number; color: number; roof: Structure['roof']; water?: number }> = {
  pond: { height: 0.6, color: 0x7c8f6a, roof: 'open', water: 1.1 },
  transfer_ps: { height: 6.0, color: 0xd9d2c3, roof: 'flat' },
  clarifier: { height: 5.2, color: 0xc9cdd0, roof: 'open', water: 0.5 },
  filters: { height: 4.6, color: 0xc9cdd0, roof: 'open', water: 0.6 },
  reservoir: { height: 1.4, color: 0xb9c3bd, roof: 'covered' },
  clean_ps: { height: 7.5, color: 0xe2dccd, roof: 'flat' },
  backwash_ps: { height: 6.5, color: 0xe2dccd, roof: 'flat' },
  chemical: { height: 6.2, color: 0xe8e1cf, roof: 'flat' },
  chlorine: { height: 5.6, color: 0xe8e1cf, roof: 'flat' },
  recovery: { height: 3.2, color: 0xbfc6c2, roof: 'open', water: 0.7 },
  sludge: { height: 3.0, color: 0xbfc6c2, roof: 'open', water: 0.8 },
  substation: { height: 5.0, color: 0xd6d0c2, roof: 'flat' },
  admin: { height: 8.6, color: 0xf1ede2, roof: 'flat' },
  guard: { height: 3.4, color: 0xf1ede2, roof: 'flat' },
  parking: { height: 2.8, color: 0x9aa4a8, roof: 'covered' },
}

interface CadPlant {
  name: string
  capacity: string
  source: string
  origin: [number, number]
  xAxisRad: number
  boundary: XY[]
  boundaryLonLat: XY[]
  structures: Array<{ id: string; no: number; name: string; kind: StructureKind; poly: XY[]; fromDrawing: boolean }>
  parts: {
    S04: { mixing: XY[]; floc: XY[][]; lamella: XY[][]; channel: XY[] }
    S05: { cells: XY[][]; gallery: XY[]; inlet: XY[] }
  }
  inletOutfall: XY
  gate: XY[]
  fountain: XY[]
  roads: XY[][]
  trees: XY[]
}
interface CadIntake {
  name: string
  source: string
  origin: [number, number]
  rotationDeg: number
  waterEdge: Array<Array<[number, number]>>
}

const P = (cad as unknown as { plant: CadPlant }).plant
const I = (cad as unknown as { intake: CadIntake }).intake

export const PLANT = {
  name: P.name,
  capacity: P.capacity,
  source: P.source,
  originLonLat: P.origin,
  /** plant origin in the map frame (metres) */
  origin: toLocal(P.origin[0], P.origin[1]),
  /** rotation of the drawing axes in the map frame (radians, counter-clockwise from east) */
  rotation: P.xAxisRad,
  boundary: P.boundary,
  boundaryLonLat: P.boundaryLonLat,
  parts: P.parts,
  inletOutfall: P.inletOutfall,
  gate: P.gate,
  fountain: P.fountain,
  roads: P.roads,
  trees: P.trees,
  structures: P.structures.map((s): Structure => ({ ...s, ...STYLE[s.kind] })),
}

export const STRUCTURE_BY_ID: Record<string, Structure> = Object.fromEntries(PLANT.structures.map(s => [s.id, s]))

/** Plant-frame point → map-frame point (metres). */
export const plantToMap = (p: readonly number[]): XY => {
  const [x, y] = rotate(p, PLANT.rotation)
  return [x + PLANT.origin[0], y + PLANT.origin[1]]
}

export const INTAKE = {
  name: I.name,
  source: I.source,
  originLonLat: I.origin,
  origin: toLocal(I.origin[0], I.origin[1]),
  /** CTT block rotation in the drawing (degrees) */
  rotation: (I.rotationDeg * Math.PI) / 180,
  waterEdge: I.waterEdge.map(l => l.map(([lon, lat]) => toLocal(lon, lat))),
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
  cx: number
  cy: number
  w: number
  h: number
}
export function rectOf(poly: readonly (readonly number[])[]): Rect {
  const xs = poly.map(p => p[0]!)
  const ys = poly.map(p => p[1]!)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
}
export const R = (id: string) => rectOf(STRUCTURE_BY_ID[id]!.poly)

// ───────────────────────────── equipment ─────────────────────────────

export type EquipmentKind =
  | 'pump'
  | 'subpump'
  | 'blower'
  | 'valve'
  | 'mixer'
  | 'flocculator'
  | 'lamella'
  | 'filter'
  | 'dosing'
  | 'tank'
  | 'chlorinator'
  | 'cylinders'
  | 'scrubber'
  | 'transformer'
  | 'analyzer'
  | 'level'
  | 'flowmeter'
  | 'pressure'
  | 'scada'
  | 'leak'
  | 'vfd'
  | 'mcc'
  | 'plc'
  | 'hmi'
  | 'dp'
  | 'camera'

export interface Equipment {
  tag: string
  name: string
  /** structure id, or 'TB1' for the river intake */
  unit: string
  kind: EquipmentKind
  /** component catalog code (@wn/component-models): the 3D model, symbol, functions and properties */
  code: string
  /** catalog size (DN) */
  dn?: number
  /** how many catalog models make this item (a row of flocculators, a rack of chlorine containers) */
  count?: number
  /** plant frame (TB1: intake frame), metres */
  pos: XY
  /** height of the equipment's base above ground (m) */
  z?: number
  /** rotation about the vertical axis (rad); catalog fronts face −y, pipe axes run along x */
  rot?: number
  spec: string
  /** has commands (start/stop, setpoint, open/close, backwash) */
  control?: 'pump' | 'valve' | 'dosing' | 'filter' | 'mixer' | 'chlorinator' | 'blower'
  /** the equipment this one drives or monitors (VFD → pump, DP transmitter → filter) */
  link?: string
  /** HMI screen it opens (local panels, SCADA) */
  screen?: HmiScreenId
}

export type HmiScreenId = 'overview' | 'tb1' | 'transfer' | 'clarifier' | 'filters' | 'pumps' | 'chemicals' | 'power' | 'network' | 'alarms' | 'trends'

const W = Math.PI / 2
function buildEquipment(): Equipment[] {
  const eq: Equipment[] = []
  const add = (e: Equipment) => eq.push(e)

  // TB1 — raw-water pumps at the river (intake frame; the pump house floor is at +5.1 m)
  for (let i = 0; i < 3; i++)
    add({ tag: `P-TB1-0${i + 1}`, name: `Bơm nước thô TB1 số ${i + 1}`, unit: 'TB1', kind: 'pump', code: 'VerticalTurbinePump', dn: 500, pos: [-4 + i * 4, 1.5], z: 5.1, spec: 'Q=1450 m³/h · H=45 m · 250 kW · biến tần', control: 'pump' })
  add({ tag: 'LT-101', name: 'Mực nước sông tại cửa thu', unit: 'TB1', kind: 'level', code: 'LevelSensor', pos: [7, -2], z: 5.1, spec: 'Radar 0–20 m · NMN min +1,78 / max +17,00' })
  add({ tag: 'FT-101', name: 'Lưu lượng nước thô DN600', unit: 'TB1', kind: 'flowmeter', code: 'BulkMeter', dn: 600, pos: [-14, -2], z: 0.9, spec: 'Điện từ DN600' })
  add({ tag: 'PLC-TB1', name: 'Tủ PLC trạm bơm TB1', unit: 'TB1', kind: 'plc', code: 'PLCPanel', pos: [-5, 4.6], z: 5.1, spec: 'PLC + I/O · 4G/cáp quang về nhà máy', screen: 'tb1' })
  add({ tag: 'HMI-TB1', name: 'Màn hình vận hành TB1', unit: 'TB1', kind: 'hmi', code: 'HMIPanel', pos: [3, -3.6], z: 5.1, spec: 'HMI 15″ tại chỗ', screen: 'tb1' })
  add({ tag: 'CAM-04', name: 'Camera cửa thu', unit: 'TB1', kind: 'camera', code: 'CCTVCamera', pos: [9, -7], spec: 'IP 4 MP · hồng ngoại 50 m', rot: -W })

  // S02 pond / S03 transfer pump station
  const pond = rectOf(STRUCTURE_BY_ID.S02!.poly)
  add({ tag: 'LT-201', name: 'Mực nước hồ sơ lắng', unit: 'S02', kind: 'level', code: 'LevelSensor', pos: [pond.cx + 30, -40], z: 0.6, spec: 'Siêu âm 0–6 m' })
  add({ tag: 'AIT-201', name: 'Độ đục nước thô', unit: 'S02', kind: 'analyzer', code: 'TurbidityMeter', pos: [PLANT.inletOutfall[0] + 4, PLANT.inletOutfall[1] + 2], spec: '0–1000 NTU' })
  const s3 = R('S03')
  for (let i = 0; i < 3; i++)
    add({ tag: `P-CT-0${i + 1}`, name: `Bơm chuyển tiếp số ${i + 1}`, unit: 'S03', kind: 'pump', code: 'VerticalTurbinePump', dn: 400, pos: [s3.cx + 0.5, s3.y0 + 3.2 + i * 4.2], rot: Math.PI, spec: 'Q=750 m³/h · H=20 m · 55 kW', control: 'pump' })
  add({ tag: 'LT-301', name: 'Mực nước giếng hút chuyển tiếp', unit: 'S03', kind: 'level', code: 'LevelSensor', pos: [s3.x0 + 1.2, s3.y1 - 1.5], z: 0, spec: 'Siêu âm 0–5 m' })
  add({ tag: 'PLC-03', name: 'Tủ PLC trạm bơm chuyển tiếp', unit: 'S03', kind: 'plc', code: 'PLCPanel', pos: [s3.x0 + 1.1, s3.cy + 2], rot: W, spec: 'PLC + MCC 3 bơm', screen: 'transfer' })
  add({ tag: 'HMI-03', name: 'Màn hình vận hành trạm chuyển tiếp', unit: 'S03', kind: 'hmi', code: 'HMIPanel', pos: [s3.x0 + 2.2, s3.y0 + 1.4], spec: 'HMI 12″ tại chỗ', screen: 'transfer' })

  // S04 mixing – flocculation – lamella
  const s4 = P.parts.S04
  const s4r = R('S04')
  const mix = rectOf(s4.mixing)
  add({ tag: 'M-401', name: 'Máy khuấy trộn nhanh', unit: 'S04', kind: 'mixer', code: 'Mixer', pos: [mix.cx, mix.cy], z: 5.2, spec: 'Trộn cơ khí · 5,5 kW', control: 'mixer' })
  const stages: Array<[string, string, number]> = [
    ['FL-401', 'Máy khuấy phản ứng bậc I', 14],
    ['FL-402', 'Máy khuấy phản ứng bậc II', 12],
    ['FL-403', 'Máy khuấy phản ứng bậc III', 8],
  ]
  stages.forEach(([tag, name, rpm], row) => {
    const cells = s4.floc.slice(row * 4, row * 4 + 4).map(rectOf)
    add({ tag, name, unit: 'S04', kind: 'flocculator', code: 'Flocculator', count: 4, pos: [(cells[0]!.cx + cells[3]!.cx) / 2, cells[1]!.cy], z: 5.2, spec: `4 ngăn · 1 kW/máy · đặt ${rpm} v/ph`, control: 'mixer' })
  })
  s4.lamella.map(rectOf).forEach((r, i) => {
    add({ tag: `LS-40${i + 1}`, name: `Bể lắng lamella số ${i + 1}`, unit: 'S04', kind: 'lamella', code: 'LamellaSettler', pos: [r.cx, r.cy], z: 5.2, spec: 'Ống lắng 2" h=900 mm · hút bùn tự động' })
    add({ tag: `MV-40${i + 1}`, name: `Van bướm điện DN600 vào lắng ${i + 1}`, unit: 'S04', kind: 'valve', code: 'MotorisedValve', dn: 600, pos: [r.cx, r.y0 - 0.4], z: 5.6, spec: 'DN600 · điện', control: 'valve' })
  })
  const ch = rectOf(s4.channel)
  add({ tag: 'AIT-401', name: 'Độ đục nước sau lắng', unit: 'S04', kind: 'analyzer', code: 'TurbidityMeter', pos: [s4r.x0 - 1.4, ch.cy - 3], rot: -W, spec: '0–100 NTU' })
  add({ tag: 'AIT-402', name: 'pH sau keo tụ', unit: 'S04', kind: 'analyzer', code: 'PHAnalyser', pos: [s4r.x0 - 1.4, mix.cy + 4], rot: -W, spec: 'pH 0–14 · ORP' })
  add({ tag: 'PLC-04', name: 'Tủ PLC cụm trộn – lắng', unit: 'S04', kind: 'plc', code: 'PLCPanel', pos: [s4r.x0 - 1.6, s4r.cy - 6], rot: -W, spec: 'PLC · điều khiển khuấy, xả bùn, van', screen: 'clarifier' })
  add({ tag: 'HMI-04', name: 'Màn hình vận hành cụm lắng', unit: 'S04', kind: 'hmi', code: 'HMIPanel', pos: [s4r.x0 - 1.6, s4r.cy - 10], rot: -W, spec: 'HMI 15″ tại chỗ', screen: 'clarifier' })

  // S05 filters
  const gal = rectOf(P.parts.S05.gallery)
  P.parts.S05.cells.map(rectOf).forEach((r, i) => {
    add({ tag: `F-50${i + 1}`, name: `Bể lọc số ${i + 1}`, unit: 'S05', kind: 'filter', code: 'RapidSandFilter', pos: [r.cx, r.cy], z: 4.6, spec: `Lọc cát · ${(r.w * r.h).toFixed(0)} m² · rửa gió + nước`, control: 'filter' })
    add({ tag: `DPT-50${i + 1}`, name: `Chênh áp bể lọc số ${i + 1}`, unit: 'S05', kind: 'dp', code: 'DPTransmitter', pos: [r.cx, gal.y0 + 0.5], z: 1.0, rot: Math.PI, spec: '0–5 m cột nước · 4–20 mA/HART', link: `F-50${i + 1}` })
  })
  add({ tag: 'AIT-501', name: 'Độ đục nước sau lọc', unit: 'S05', kind: 'analyzer', code: 'TurbidityMeter', pos: [gal.x1 - 1.6, gal.cy + 0.6], z: 0, spec: '0–10 NTU' })
  add({ tag: 'PLC-05', name: 'Tủ PLC điều khiển bể lọc', unit: 'S05', kind: 'plc', code: 'PLCPanel', pos: [gal.x0 + 1.4, gal.y1 - 0.5], spec: 'PLC · trình tự rửa lọc tự động', screen: 'filters' })
  add({ tag: 'HMI-05', name: 'Màn hình hành lang ống bể lọc', unit: 'S05', kind: 'hmi', code: 'HMIPanel', pos: [gal.x0 + 4.2, gal.cy - 0.6], spec: 'HMI 15″ tại chỗ', screen: 'filters' })

  // S06 clear-water reservoir
  const s6 = R('S06')
  add({ tag: 'LT-601', name: 'Mực nước bể chứa 10.000 m³', unit: 'S06', kind: 'level', code: 'LevelSensor', pos: [s6.x0 + 3, s6.y1 - 3], z: 1.4, spec: 'Radar 0–5,3 m' })
  add({ tag: 'AIT-601', name: 'Clo dư bể chứa', unit: 'S06', kind: 'analyzer', code: 'ChlorineAnalyser', pos: [s6.x1 - 3, s6.y1 - 3], z: 1.4, spec: '0–5 mg/L' })
  add({ tag: 'AIT-602', name: 'pH nước sạch', unit: 'S06', kind: 'analyzer', code: 'PHAnalyser', pos: [s6.x1 - 5, s6.y1 - 3], z: 1.4, spec: 'pH 0–14' })

  // S07 clean-water pumps
  const s7 = R('S07')
  for (let i = 0; i < 3; i++) {
    const x = s7.x1 - 9 - i * 8.5
    add({ tag: `P-NS-0${i + 1}`, name: `Bơm nước sạch số ${i + 1}`, unit: 'S07', kind: 'pump', code: 'Pump', dn: 500, pos: [x, s7.cy - 1.2], rot: W, spec: 'Q=850 m³/h · H=50 m · 160 kW · biến tần', control: 'pump' })
    add({ tag: `VFD-NS-0${i + 1}`, name: `Biến tần bơm nước sạch số ${i + 1}`, unit: 'S07', kind: 'vfd', code: 'VFDPanel', pos: [x + 2.6, s7.y1 - 0.65], spec: '200 kW · 400 V · Modbus TCP', link: `P-NS-0${i + 1}` })
  }
  add({ tag: 'MV-701', name: 'Van điện ống ra D1000', unit: 'S07', kind: 'valve', code: 'MotorisedValve', dn: 1000, pos: [s7.x0 + 3.2, s7.cy + 2.6], z: 0.75, spec: 'DN1000 thép · điện', control: 'valve' })
  add({ tag: 'FT-701', name: 'Lưu lượng nước sạch D1000', unit: 'S07', kind: 'flowmeter', code: 'BulkMeter', dn: 1000, pos: [s7.x0 + 7.5, s7.cy + 2.6], z: 0.75, spec: 'Điện từ DN1000' })
  add({ tag: 'PT-701', name: 'Áp lực đầu ra nhà máy', unit: 'S07', kind: 'pressure', code: 'PressureSensor', pos: [s7.x0 + 10.5, s7.cy + 2.6], z: 1.3, spec: '0–10 bar' })
  add({ tag: 'MCC-07', name: 'Tủ MCC trạm bơm nước sạch', unit: 'S07', kind: 'mcc', code: 'MCC', pos: [s7.x0 + 4.2, s7.y1 - 0.65], spec: '4 ngăn · ACB 1600 A' })
  add({ tag: 'PLC-07', name: 'Tủ PLC trạm bơm nước sạch', unit: 'S07', kind: 'plc', code: 'PLCPanel', pos: [s7.x0 + 9, s7.y1 - 0.65], spec: 'PLC · điều áp, luân phiên bơm', screen: 'pumps' })
  add({ tag: 'HMI-07', name: 'Màn hình vận hành trạm bơm nước sạch', unit: 'S07', kind: 'hmi', code: 'HMIPanel', pos: [s7.x1 - 3.5, s7.cy + 1.8], spec: 'HMI 15″ tại chỗ', screen: 'pumps' })

  // S07B backwash pumps + blowers
  const s7b = R('S07B')
  for (let i = 0; i < 2; i++)
    add({ tag: `P-RL-0${i + 1}`, name: `Bơm rửa lọc số ${i + 1}`, unit: 'S07B', kind: 'pump', code: 'Pump', dn: 400, pos: [s7b.x0 + 4 + i * 5.5, s7b.cy - 1.2], rot: W, spec: 'Q=1050 m³/h · H=15 m · 75 kW', control: 'pump' })
  for (let i = 0; i < 2; i++)
    add({ tag: `B-70${i + 1}`, name: `Máy thổi khí rửa lọc số ${i + 1}`, unit: 'S07B', kind: 'blower', code: 'Blower', dn: 300, pos: [s7b.x0 + 15 + i * 5, s7b.cy - 0.6], spec: 'Q=75 m³/ph · H=5 m · 90 kW', control: 'blower' })

  // S08 chemicals
  const s8 = R('S08')
  for (let i = 0; i < 2; i++) {
    add({ tag: `T-PAC-0${i + 1}`, name: `Bồn pha PAC 17 % số ${i + 1}`, unit: 'S08', kind: 'tank', code: 'ChemicalTank', dn: 50, pos: [s8.x0 + 2.6 + i * 3.6, s8.y1 - 2.6], spec: '5 m³ · máy khuấy' })
    add({ tag: `DP-PAC-0${i + 1}`, name: `Bơm định lượng PAC số ${i + 1}`, unit: 'S08', kind: 'dosing', code: 'DosingPump', dn: 25, pos: [s8.x0 + 2.2 + i * 2.2, s8.y0 + 2], spec: 'Màng · 0–400 L/h', control: 'dosing' })
  }
  add({ tag: 'T-POL-01', name: 'Bồn pha polymer', unit: 'S08', kind: 'tank', code: 'ChemicalTank', dn: 25, pos: [s8.x1 - 2.4, s8.y1 - 2.4], spec: '2 m³ · máy khuấy' })
  add({ tag: 'DP-POL-01', name: 'Bơm định lượng polymer', unit: 'S08', kind: 'dosing', code: 'DosingPump', dn: 15, pos: [s8.x1 - 2.4, s8.y0 + 2], spec: 'Màng · 0–60 L/h', control: 'dosing' })
  add({ tag: 'PLC-08', name: 'Tủ PLC hóa chất & clo', unit: 'S08', kind: 'plc', code: 'PLCPanel', pos: [s8.x1 - 0.65, s8.cy], rot: -W, spec: 'PLC · định lượng theo lưu lượng', screen: 'chemicals' })

  // S09 chlorine
  const s9 = R('S09')
  add({ tag: 'CYL-901', name: 'Bình clo lỏng 900 kg (10 bình)', unit: 'S09', kind: 'cylinders', code: 'ChlorineContainer', count: 10, pos: [s9.x0 + 5.5, s9.cy + 0.6], spec: '10 × 900 kg · cân điện tử' })
  add({ tag: 'CL-901', name: 'Clorator clo hóa sơ bộ', unit: 'S09', kind: 'chlorinator', code: 'Chlorinator', pos: [s9.x1 - 4.6, s9.y1 - 0.4], rot: Math.PI, spec: '0–10 kg/h', control: 'chlorinator' })
  add({ tag: 'CL-902', name: 'Clorator khử trùng', unit: 'S09', kind: 'chlorinator', code: 'Chlorinator', pos: [s9.x1 - 2.2, s9.y1 - 0.4], rot: Math.PI, spec: '0–10 kg/h', control: 'chlorinator' })
  add({ tag: 'GD-901', name: 'Đầu dò rò rỉ clo', unit: 'S09', kind: 'leak', code: 'GasDetector', pos: [s9.x0 + 1, s9.y0 + 0.4], z: 0.6, rot: Math.PI, spec: '0–10 ppm' })
  add({ tag: 'SC-901', name: 'Tháp trung hòa clo', unit: 'S09', kind: 'scrubber', code: 'Scrubber', dn: 200, pos: [s9.x0 - 2.6, s9.cy], rot: Math.PI, spec: 'Trung hòa NaOH · quạt hút' })
  add({ tag: 'CAM-02', name: 'Camera nhà clo', unit: 'S09', kind: 'camera', code: 'CCTVCamera', pos: [s9.x0 - 1.2, s9.y1 + 1.6], rot: Math.PI, spec: 'IP 4 MP' })

  // S10 recovery tank
  const s10 = R('S10')
  for (let i = 0; i < 2; i++)
    add({ tag: `P-TH-0${i + 1}`, name: `Bơm chìm thu hồi số ${i + 1}`, unit: 'S10', kind: 'subpump', code: 'SubmersiblePump', dn: 150, pos: [s10.x1 - 2.5, s10.y0 + 2.6 + i * 3.4], z: 3.2, spec: 'Q=150 m³/h · H=12 m · 11 kW', control: 'pump' })
  add({ tag: 'LT-1001', name: 'Mực nước bể thu hồi', unit: 'S10', kind: 'level', code: 'LevelSensor', pos: [s10.x0 + 1.5, s10.y1 - 1.5], z: 3.2, spec: 'Siêu âm 0–3 m' })

  // S11 substation, S12 admin, site cameras
  const s11 = R('S11')
  add({ tag: 'TR-1101', name: 'Máy biến áp 22/0,4 kV', unit: 'S11', kind: 'transformer', code: 'Transformer', pos: [s11.x1 + 3.6, s11.cy], rot: W, spec: '1600 kVA' })
  add({ tag: 'MSB-1101', name: 'Tủ điện tổng hạ thế', unit: 'S11', kind: 'mcc', code: 'MCC', pos: [s11.cx, s11.y1 - 0.7], spec: 'ACB 2500 A · đo đếm điện năng', screen: 'power' })
  const s12 = R('S12')
  add({ tag: 'SCADA', name: 'Phòng điều khiển trung tâm SCADA', unit: 'S12', kind: 'scada', code: 'SCADAWorkstation', pos: [s12.cx, s12.cy], spec: 'Máy chủ SCADA dự phòng kép · 3 màn hình · video wall', screen: 'overview' })
  add({ tag: 'CAM-01', name: 'Camera cổng nhà máy', unit: 'S12', kind: 'camera', code: 'CCTVCamera', pos: [PLANT.gate[0]![0] - 3, PLANT.gate[0]![1] - 3], rot: W, spec: 'IP 4 MP · nhận dạng biển số' })
  add({ tag: 'CAM-03', name: 'Camera trạm bơm nước sạch', unit: 'S07', kind: 'camera', code: 'CCTVCamera', pos: [s7.x0 - 1.5, s7.y0 - 1.5], rot: Math.PI, spec: 'IP 4 MP' })
  return eq
}

export const EQUIPMENT = buildEquipment()
export const EQUIPMENT_BY_TAG: Record<string, Equipment> = Object.fromEntries(EQUIPMENT.map(e => [e.tag, e]))

/** Process units listed in the factory view (tree order follows the water). */
export const UNITS: Array<{ id: string; name: string }> = [
  { id: 'TB1', name: 'Công trình thu & TB nước thô (TB1)' },
  { id: 'S02', name: 'Hồ chứa nước thô (sơ lắng)' },
  { id: 'S03', name: 'Trạm bơm chuyển tiếp' },
  { id: 'S04', name: 'Cụm trộn – phản ứng – lắng lamella' },
  { id: 'S05', name: 'Cụm bể lọc' },
  { id: 'S06', name: 'Bể chứa nước sạch 10.000 m³' },
  { id: 'S07', name: 'Trạm bơm nước sạch' },
  { id: 'S07B', name: 'Gian bơm rửa lọc & máy gió' },
  { id: 'S08', name: 'Nhà hóa chất (PAC, polymer)' },
  { id: 'S09', name: 'Nhà clo' },
  { id: 'S10', name: 'Bể thu hồi nước xả' },
  { id: 'S11', name: 'Trạm điện' },
  { id: 'S12', name: 'Nhà điều hành' },
]
