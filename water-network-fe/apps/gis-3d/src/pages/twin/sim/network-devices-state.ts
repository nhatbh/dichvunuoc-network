/**
 * Live state of the network's catalog components (mock telemetry), derived from the hydraulic solution and
 * the plant simulation: catalog status (normal / warning / critical / offline) and the readings an operator sees.
 */
import { fmtClock, type PlantSim } from './plant-sim'
import { DEVICE_BY_ID, type NetDevice } from '../data/network-devices'
import type { NetworkSolution } from '../data/network-model'
import type { Status } from '@wn/component-models'

export interface Reading {
  k: string
  v: string
  u?: string
  warn?: boolean
}

const f1 = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const f2 = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const f0 = (n: number) => Math.round(n).toLocaleString('vi-VN')
/** stable pseudo-random 0..1 per id */
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}
/** the one acoustic logger that hears a leak, for the demo */
const LEAK_LOGGER = 'AL-3'

export function deviceStatus(d: NetDevice, sol: NetworkSolution | null, sim: PlantSim): Status {
  const st = d.pipe ? sol?.pipes.get(d.pipe) : undefined
  if (d.code === 'GateValve' && sim.closedNetValves.has(d.id)) return 'critical'
  if (st && !st.supplied && d.code !== 'TappingSaddle') return 'offline'
  const cl = sim.clRes * 0.92
  switch (d.code) {
    case 'PressureSensor':
      return !st ? 'offline' : st.p < 12 ? 'critical' : st.p < 20 ? 'warning' : 'normal'
    case 'ChlorineAnalyser':
    case 'QualitySensor':
      return cl < 0.2 ? 'critical' : cl < 0.3 ? 'warning' : 'normal'
    case 'Hydrant':
      return st && st.p < 10 ? 'warning' : 'normal'
    case 'AcousticLogger':
      return d.id === LEAK_LOGGER ? 'warning' : 'normal'
    case 'BulkMeter':
      return st && Math.abs(st.q) < 1 ? 'warning' : 'normal'
    default:
      return 'normal'
  }
}

export function deviceReadings(id: string, sol: NetworkSolution | null, sim: PlantSim): Reading[] {
  const d = DEVICE_BY_ID[id]
  if (!d) return []
  const st = d.pipe ? sol?.pipes.get(d.pipe) : undefined
  const p = st?.p ?? 0
  const q = Math.abs(st?.q ?? 0)
  const last = { k: 'Gửi dữ liệu lần cuối', v: fmtClock(sim.t - (hash(id) * 280 + 20)) }
  const clock = sim.t / 3600
  switch (d.code) {
    case 'PressureSensor':
      return [{ k: 'Áp lực', v: `${f1(p)} m · ${f2(p / 10.2)} bar`, warn: p < 20 }, { k: 'Pin', v: `${f0(62 + hash(id) * 35)}`, u: '%' }, { k: 'Sóng 4G', v: `${f0(-70 - hash(id) * 25)}`, u: 'dBm' }, last]
    case 'BulkMeter':
      return [{ k: 'Lưu lượng', v: f1(q), u: 'm³/h' }, { k: 'Vận tốc', v: f2(Math.abs(st?.v ?? 0)), u: 'm/s' }, { k: 'Chỉ số tổng', v: f0(812_000 + hash(id) * 90_000 + sim.prodToday * 0.11), u: 'm³' }, last]
    case 'ChlorineAnalyser':
    case 'QualitySensor':
      return [{ k: 'Clo dư', v: f2(sim.clRes * 0.92), u: 'mg/L', warn: sim.clRes * 0.92 < 0.3 }, { k: 'Độ đục', v: f2(sim.filteredTurb * 1.1), u: 'NTU' }, { k: 'pH', v: f2(7.1 + 0.1 * Math.sin(clock)) }, last]
    case 'Hydrant':
      return [{ k: 'Áp lực sẵn có', v: f1(p), u: 'm', warn: p < 10 }, { k: 'Lưu lượng chữa cháy ước tính', v: f0(Math.max(0, 10 * Math.sqrt(Math.max(0, p - 10)))), u: 'L/s' }, { k: 'Kiểm tra gần nhất', v: `${1 + Math.floor(hash(id) * 11)}/2026` }]
    case 'GateValve':
    case 'ButterflyValve':
      return [{ k: 'Trạng thái', v: sim.closedNetValves.has(id) ? 'ĐÓNG' : 'MỞ', warn: sim.closedNetValves.has(id) }, { k: 'Số vòng quay đóng', v: f0(8 + d.dn / 12) }, { k: 'Lưu lượng qua van', v: f1(q), u: 'm³/h' }]
    case 'MotorisedValve':
      return [{ k: 'Độ mở', v: '100', u: '%' }, { k: 'Chế độ', v: 'TỰ ĐỘNG (giữ áp 3,5 bar)' }, { k: 'Áp sau van', v: f1(p), u: 'm' }, last]
    case 'RTU':
      return [{ k: 'Kết nối', v: '4G · MQTT' }, { k: 'Nguồn', v: hash(id) > 0.5 ? 'Pin mặt trời' : 'Lưới điện' }, { k: 'Chu kỳ gửi', v: '5', u: 'phút' }, last]
    case 'AcousticLogger': {
      const leak = id === LEAK_LOGGER
      return [{ k: 'Mức ồn đêm', v: f0(leak ? 38 : 12 + hash(id) * 9), u: 'dB', warn: leak }, { k: 'Khả năng rò rỉ', v: leak ? 'CAO – cần nghe kiểm tra' : 'Thấp', warn: leak }, last]
    }
    case 'AirValve':
      return [{ k: 'Trạng thái', v: 'Đóng (đầy nước)' }, { k: 'Áp lực', v: f1(p), u: 'm' }]
    case 'Washout':
      return [{ k: 'Trạng thái', v: 'Đóng' }, { k: 'Xả cặn gần nhất', v: `${1 + Math.floor(hash(id) * 27)}/10/2026` }]
    case 'CustomerMeter':
      return [{ k: 'Chỉ số', v: f0(1200 + hash(id) * 4800), u: 'm³' }, { k: 'Tiêu thụ giờ này', v: f2(0.2 + hash(id) * 1.4 * sim.demandFactor), u: 'm³' }, { k: 'Số hộ trong cụm', v: f0(4 + hash(id) * 14) }]
    case 'SamplingPoint':
      return [{ k: 'Lấy mẫu gần nhất', v: `${1 + Math.floor(hash(id) * 18)}/11/2026` }, { k: 'Clo dư (mẫu)', v: f2(sim.clRes * 0.9), u: 'mg/L' }]
    case 'TappingSaddle':
      return [{ k: 'Ống chính × nhánh', v: `DN${d.dn} × D${d.dn2 ?? 50}` }, { k: 'Áp lực tại điểm', v: f1(p), u: 'm' }]
    default:
      return [{ k: 'Đường kính', v: `DN${d.dn}${d.dn2 ? ' × ' + d.dn2 : ''}` }, { k: 'Áp lực tại nút', v: f1(p), u: 'm' }]
  }
}
