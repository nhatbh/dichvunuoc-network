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

export interface Equipment {
  tag: string
  name: string
  /** structure id, or 'TB1' for the river intake */
  unit: string
  kind: EquipmentKind
  /** plant frame (TB1: intake frame), metres */
  pos: XY
  /** height of the equipment's base above ground (m) */
  z?: number
  /** rotation about the vertical axis (rad) */
  rot?: number
  spec: string
  /** has commands (start/stop, setpoint, open/close, backwash) */
  control?: 'pump' | 'valve' | 'dosing' | 'filter' | 'mixer' | 'chlorinator' | 'blower'
}

function buildEquipment(): Equipment[] {
  const eq: Equipment[] = []
  const add = (e: Equipment) => eq.push(e)

  // TB1 — raw-water pumps at the river (intake frame)
  for (let i = 0; i < 3; i++)
    add({
      tag: `P-TB1-0${i + 1}`,
      name: `Bơm nước thô TB1 số ${i + 1}`,
      unit: 'TB1',
      kind: 'pump',
      pos: [-4 + i * 4, 1],
      spec: 'Q=1450 m³/h · H=45 m · 250 kW · biến tần',
      control: 'pump',
    })
  add({ tag: 'LT-101', name: 'Mực nước sông tại cửa thu', unit: 'TB1', kind: 'level', pos: [-8, -6], spec: 'Radar 0–20 m · NMN min +1,78 / max +17,00', })
  add({ tag: 'FT-101', name: 'Lưu lượng nước thô DN600', unit: 'TB1', kind: 'flowmeter', pos: [8, 6], spec: 'Điện từ DN600', })

  // S02 pond / S03 transfer pump station
  const pond = rectOf(STRUCTURE_BY_ID.S02!.poly)
  add({ tag: 'LT-201', name: 'Mực nước hồ sơ lắng', unit: 'S02', kind: 'level', pos: [pond.cx + 30, -40], spec: 'Siêu âm 0–6 m' })
  add({ tag: 'AIT-201', name: 'Độ đục nước thô', unit: 'S02', kind: 'analyzer', pos: [PLANT.inletOutfall[0] + 4, PLANT.inletOutfall[1] + 2], spec: '0–1000 NTU' })
  const s3 = R('S03')
  for (let i = 0; i < 3; i++)
    add({
      tag: `P-CT-0${i + 1}`,
      name: `Bơm chuyển tiếp số ${i + 1}`,
      unit: 'S03',
      kind: 'pump',
      pos: [s3.cx + 0.5, s3.y0 + 3.2 + i * 4.2],
      rot: Math.PI,
      spec: 'Q=750 m³/h · H=20 m · 55 kW',
      control: 'pump',
    })
  add({ tag: 'LT-301', name: 'Mực nước giếng hút chuyển tiếp', unit: 'S03', kind: 'level', pos: [s3.x0 + 1.2, s3.y1 - 1.5], z: 0, spec: 'Siêu âm 0–5 m' })

  // S04 mixing – flocculation – lamella
  const s4 = P.parts.S04
  const mix = rectOf(s4.mixing)
  add({ tag: 'M-401', name: 'Máy khuấy trộn nhanh', unit: 'S04', kind: 'mixer', pos: [mix.cx, mix.cy], z: 5.2, spec: 'Trộn cơ khí · 5,5 kW', control: 'mixer' })
  const stages: Array<[string, string, number]> = [
    ['FL-401', 'Máy khuấy phản ứng bậc I', 14],
    ['FL-402', 'Máy khuấy phản ứng bậc II', 12],
    ['FL-403', 'Máy khuấy phản ứng bậc III', 8],
  ]
  stages.forEach(([tag, name, rpm], row) => {
    const cells = s4.floc.slice(row * 4, row * 4 + 4).map(rectOf)
    const c = cells[1]!
    add({ tag, name, unit: 'S04', kind: 'flocculator', pos: [(cells[0]!.cx + cells[3]!.cx) / 2, c.cy], z: 5.2, spec: `4 ngăn · 1 kW/máy · đặt ${rpm} v/ph`, control: 'mixer' })
  })
  s4.lamella.map(rectOf).forEach((r, i) => {
    add({ tag: `LS-40${i + 1}`, name: `Bể lắng lamella số ${i + 1}`, unit: 'S04', kind: 'lamella', pos: [r.cx, r.cy], z: 5.2, spec: 'Ống lắng 2" h=900 mm · hút bùn tự động' })
    add({ tag: `MV-40${i + 1}`, name: `Van bướm điện DN600 vào lắng ${i + 1}`, unit: 'S04', kind: 'valve', pos: [r.cx, r.y0 - 0.4], z: 5.4, spec: 'DN600 · điện', control: 'valve' })
  })
  const ch = rectOf(s4.channel)
  add({ tag: 'AIT-401', name: 'Độ đục nước sau lắng', unit: 'S04', kind: 'analyzer', pos: [ch.x1 - 1.5, ch.cy], z: 5.2, spec: '0–100 NTU' })

  // S05 filters
  P.parts.S05.cells.map(rectOf).forEach((r, i) => {
    add({ tag: `F-50${i + 1}`, name: `Bể lọc số ${i + 1}`, unit: 'S05', kind: 'filter', pos: [r.cx, r.cy], z: 4.6, spec: `Lọc cát · ${(r.w * r.h).toFixed(0)} m² · rửa gió + nước`, control: 'filter' })
  })
  const gal = rectOf(P.parts.S05.gallery)
  add({ tag: 'AIT-501', name: 'Độ đục nước sau lọc', unit: 'S05', kind: 'analyzer', pos: [gal.x1 - 1.6, gal.cy], z: 0, spec: '0–10 NTU' })

  // S06 clear-water reservoir
  const s6 = R('S06')
  add({ tag: 'LT-601', name: 'Mực nước bể chứa 10.000 m³', unit: 'S06', kind: 'level', pos: [s6.x0 + 3, s6.y1 - 3], z: 1.4, spec: 'Radar 0–5,3 m' })
  add({ tag: 'AIT-601', name: 'Clo dư bể chứa', unit: 'S06', kind: 'analyzer', pos: [s6.x1 - 3, s6.y1 - 3], z: 1.4, spec: '0–5 mg/L' })

  // S07 clean-water pumps
  const s7 = R('S07')
  for (let i = 0; i < 3; i++)
    add({
      tag: `P-NS-0${i + 1}`,
      name: `Bơm nước sạch số ${i + 1}`,
      unit: 'S07',
      kind: 'pump',
      pos: [s7.x1 - 9 - i * 8.5, s7.cy - 1.2],
      rot: -Math.PI / 2,
      spec: 'Q=850 m³/h · H=50 m · 160 kW · biến tần',
      control: 'pump',
    })
  add({ tag: 'MV-701', name: 'Van cổng điện ống ra D1000', unit: 'S07', kind: 'valve', pos: [s7.x0 + 3.2, s7.cy + 2.6], z: 0.2, rot: Math.PI / 2, spec: 'DN1000 thép · điện', control: 'valve' })
  add({ tag: 'FT-701', name: 'Lưu lượng nước sạch D1000', unit: 'S07', kind: 'flowmeter', pos: [s7.x0 + 7.5, s7.cy + 2.6], z: 0.2, spec: 'Điện từ DN1000' })
  add({ tag: 'PT-701', name: 'Áp lực đầu ra nhà máy', unit: 'S07', kind: 'pressure', pos: [s7.x0 + 11, s7.cy + 2.6], z: 1.4, spec: '0–10 bar' })

  // S07B backwash pumps + blowers
  const s7b = R('S07B')
  for (let i = 0; i < 2; i++)
    add({
      tag: `P-RL-0${i + 1}`,
      name: `Bơm rửa lọc số ${i + 1}`,
      unit: 'S07B',
      kind: 'pump',
      pos: [s7b.x0 + 4 + i * 5.5, s7b.cy - 1.2],
      rot: -Math.PI / 2,
      spec: 'Q=1050 m³/h · H=15 m · 75 kW',
      control: 'pump',
    })
  for (let i = 0; i < 2; i++)
    add({
      tag: `B-70${i + 1}`,
      name: `Máy thổi khí rửa lọc số ${i + 1}`,
      unit: 'S07B',
      kind: 'blower',
      pos: [s7b.x0 + 15 + i * 5, s7b.cy - 0.8],
      spec: 'Q=75 m³/ph · H=5 m · 90 kW',
      control: 'blower',
    })

  // S08 chemicals
  const s8 = R('S08')
  for (let i = 0; i < 2; i++) {
    add({ tag: `T-PAC-0${i + 1}`, name: `Bồn pha PAC 17 % số ${i + 1}`, unit: 'S08', kind: 'tank', pos: [s8.x0 + 2.6 + i * 3.6, s8.y1 - 2.6], spec: '5 m³ · máy khuấy' })
    add({ tag: `DP-PAC-0${i + 1}`, name: `Bơm định lượng PAC số ${i + 1}`, unit: 'S08', kind: 'dosing', pos: [s8.x0 + 2.2 + i * 2.2, s8.y0 + 2], spec: 'Màng · 0–400 L/h', control: 'dosing' })
  }
  add({ tag: 'T-POL-01', name: 'Bồn pha polymer', unit: 'S08', kind: 'tank', pos: [s8.x1 - 2.4, s8.y1 - 2.4], spec: '2 m³ · máy khuấy' })
  add({ tag: 'DP-POL-01', name: 'Bơm định lượng polymer', unit: 'S08', kind: 'dosing', pos: [s8.x1 - 2.4, s8.y0 + 2], spec: 'Màng · 0–60 L/h', control: 'dosing' })

  // S09 chlorine
  const s9 = R('S09')
  add({ tag: 'CYL-901', name: 'Bình clo lỏng 900 kg (10 bình)', unit: 'S09', kind: 'cylinders', pos: [s9.x0 + 5.5, s9.cy + 0.6], spec: '10 × 900 kg · cân điện tử' })
  add({ tag: 'CL-901', name: 'Clorator clo hóa sơ bộ', unit: 'S09', kind: 'chlorinator', pos: [s9.x1 - 4.6, s9.y1 - 0.6], z: 1.2, spec: '0–10 kg/h', control: 'chlorinator' })
  add({ tag: 'CL-902', name: 'Clorator khử trùng', unit: 'S09', kind: 'chlorinator', pos: [s9.x1 - 2.2, s9.y1 - 0.6], z: 1.2, spec: '0–10 kg/h', control: 'chlorinator' })
  add({ tag: 'GD-901', name: 'Đầu dò rò rỉ clo', unit: 'S09', kind: 'leak', pos: [s9.x0 + 1, s9.y0 + 1], z: 0.3, spec: '0–10 ppm' })
  add({ tag: 'SC-901', name: 'Tháp trung hòa clo', unit: 'S09', kind: 'scrubber', pos: [s9.x0 - 2.2, s9.cy], spec: 'Trung hòa NaOH · quạt hút' })

  // S10 recovery tank
  const s10 = R('S10')
  for (let i = 0; i < 2; i++)
    add({ tag: `P-TH-0${i + 1}`, name: `Bơm chìm thu hồi số ${i + 1}`, unit: 'S10', kind: 'subpump', pos: [s10.x1 - 2.5, s10.y0 + 2.6 + i * 3.4], z: 3.2, spec: 'Q=150 m³/h · H=12 m · 11 kW', control: 'pump' })
  add({ tag: 'LT-1001', name: 'Mực nước bể thu hồi', unit: 'S10', kind: 'level', pos: [s10.x0 + 1.5, s10.y1 - 1.5], z: 3.2, spec: 'Siêu âm 0–3 m' })

  // S11 substation, S12 admin
  const s11 = R('S11')
  add({ tag: 'TR-1101', name: 'Máy biến áp 22/0,4 kV', unit: 'S11', kind: 'transformer', pos: [s11.x1 + 3.6, s11.cy], spec: '1600 kVA' })
  const s12 = R('S12')
  add({ tag: 'SCADA', name: 'Phòng điều khiển trung tâm SCADA', unit: 'S12', kind: 'scada', pos: [s12.cx, s12.cy], z: 0, spec: 'Máy chủ SCADA · HMI · tủ mạng' })
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
