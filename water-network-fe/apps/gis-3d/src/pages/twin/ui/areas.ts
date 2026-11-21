/**
 * How the plant is organised for the operator: areas grouped by process stage (the way the water goes), and
 * equipment grouped by type. Also each area's live status and the one number that matters most for it.
 */
import { f0, f1, f2 } from './sim-context'
import { EQUIPMENT, type Equipment } from '../data/plant-model'
import type { PlantSim } from '../sim/plant-sim'

export type StageId = 'raw' | 'treat' | 'clean' | 'chem' | 'util'
/** water colour of each stage: brown raw water, green-grey settled, blue clean (same as the P&ID mimics) */
export const STAGES: Array<{ id: StageId; label: string; color: string; units: string[] }> = [
  { id: 'raw', label: 'Nước thô', color: '#9c7a4a', units: ['TB1', 'S02', 'S03'] },
  { id: 'treat', label: 'Xử lý', color: '#4f9a91', units: ['S04', 'S05', 'S07B', 'S10'] },
  { id: 'clean', label: 'Nước sạch', color: '#2f86d6', units: ['S06', 'S07'] },
  { id: 'chem', label: 'Hóa chất', color: '#c9971c', units: ['S08', 'S09'] },
  { id: 'util', label: 'Phụ trợ', color: '#6c7a86', units: ['S11', 'S12'] },
]
export const STAGE_OF: Record<string, (typeof STAGES)[number]> = Object.fromEntries(STAGES.flatMap(s => s.units.map(u => [u, s])))

/** short names, for lists, labels and the process strip */
export const SHORT: Record<string, string> = {
  TB1: 'Trạm bơm nước thô TB1',
  S02: 'Hồ sơ lắng',
  S03: 'Trạm bơm chuyển tiếp',
  S04: 'Trộn, phản ứng, lắng',
  S05: 'Bể lọc nhanh',
  S06: 'Bể chứa nước sạch',
  S07: 'Trạm bơm nước sạch',
  S07B: 'Rửa lọc & máy gió',
  S08: 'Nhà hóa chất',
  S09: 'Nhà clo',
  S10: 'Thu hồi nước xả',
  S11: 'Trạm điện',
  S12: 'Nhà điều hành',
}

export type UnitState = 'run' | 'man' | 'stop' | 'fault'
export const unitItems = (id: string) => EQUIPMENT.filter(e => e.unit === id)

/** worst state of an area: a fault or a critical alarm, a warning, something running, or all stopped */
export function unitState(sim: PlantSim, id: string): UnitState {
  const items = unitItems(id)
  if (items.some(e => sim.dev[e.tag]?.fault)) return 'fault'
  const alarms = sim.activeAlarms.filter(a => items.some(e => e.tag === a.tag))
  if (alarms.some(a => a.level === 'crit')) return 'fault'
  if (alarms.length || items.some(e => e.control && sim.dev[e.tag]?.mode === 'man')) return 'man'
  const ctl = items.filter(e => e.control)
  return !ctl.length || ctl.some(e => sim.dev[e.tag]?.run) ? 'run' : 'stop'
}

/** "2/3 đang chạy" for areas with machines, otherwise the equipment count */
export function unitDuty(sim: PlantSim, id: string) {
  const items = unitItems(id)
  const ctl = items.filter(e => e.control === 'pump' || e.control === 'blower' || e.control === 'mixer' || e.control === 'dosing')
  if (id === 'S05') {
    const f = items.filter(e => e.kind === 'filter').map(e => sim.dev[e.tag]!)
    const wash = f.filter(d => d.phase !== 'filter' && d.phase !== 'standby').length
    return `${f.length - wash}/${f.length} bể đang lọc${wash ? `, ${wash} đang rửa` : ''}`
  }
  if (!ctl.length) return `${items.length} thiết bị`
  return `${ctl.filter(e => sim.dev[e.tag]?.run).length}/${ctl.length} máy chạy, ${items.length} thiết bị`
}

/** the one number an operator looks at first for an area */
export function unitMetric(sim: PlantSim, id: string): { v: string; u?: string; warn?: boolean; k: string } {
  switch (id) {
    case 'TB1':
      return { k: 'Nước thô', v: f0(sim.qRaw), u: 'm³/h' }
    case 'S02':
      return { k: 'Mực nước', v: f1(sim.pondLevel), u: 'm', warn: sim.pondLevel < 1.2 }
    case 'S03':
      return { k: 'Chuyển tiếp', v: f0(sim.qTransfer), u: 'm³/h' }
    case 'S04':
      return { k: 'Đục sau lắng', v: f1(sim.settledTurb), u: 'NTU', warn: sim.settledTurb > 5 }
    case 'S05':
      return { k: 'Đục sau lọc', v: f2(sim.filteredTurb), u: 'NTU', warn: sim.filteredTurb > 1 }
    case 'S07B':
      return { k: 'Rửa lọc', v: sim.qBackwash > 1 ? f0(sim.qBackwash) : 'Chờ', u: sim.qBackwash > 1 ? 'm³/h' : undefined }
    case 'S10':
      return { k: 'Nước xả', v: sim.qBackwash > 1 ? 'Đang nhận' : 'Chờ' }
    case 'S06':
      return { k: 'Mực bể', v: f0(sim.reservoirPct), u: '%', warn: sim.reservoirPct < 20 }
    case 'S07':
      return { k: 'Phát ra', v: f0(sim.qOut), u: 'm³/h', warn: sim.pOut < 2.5 }
    case 'S08':
      return { k: 'Liều PAC', v: f1(sim.pacDose), u: 'mg/L' }
    case 'S09':
      return sim.leak > 0.3 ? { k: 'Rò rỉ clo', v: f1(sim.leak), u: 'ppm', warn: true } : { k: 'Clo dư', v: f2(sim.clRes), u: 'mg/L', warn: sim.clRes < 0.3 }
    case 'S11':
      return { k: 'Công suất', v: f0(sim.powerKw), u: 'kW' }
    default:
      return { k: 'SCADA', v: 'Trực tuyến' }
  }
}

// ───────────── equipment by type ─────────────
export type TypeId = 'machine' | 'valve' | 'instr' | 'process' | 'elec'
export const TYPES: Array<{ id: TypeId; label: string; kinds: Array<Equipment['kind']> }> = [
  { id: 'machine', label: 'Bơm & máy', kinds: ['pump', 'subpump', 'blower', 'mixer', 'flocculator'] },
  { id: 'valve', label: 'Van', kinds: ['valve'] },
  { id: 'instr', label: 'Đo lường', kinds: ['level', 'flowmeter', 'analyzer', 'pressure', 'dp', 'leak'] },
  { id: 'process', label: 'Xử lý & hóa chất', kinds: ['filter', 'lamella', 'tank', 'dosing', 'chlorinator', 'cylinders', 'scrubber'] },
  { id: 'elec', label: 'Điện & điều khiển', kinds: ['vfd', 'mcc', 'plc', 'hmi', 'scada', 'transformer', 'camera'] },
]
export const TYPE_OF = (e: Equipment): TypeId => TYPES.find(t => t.kinds.includes(e.kind))?.id ?? 'elec'
