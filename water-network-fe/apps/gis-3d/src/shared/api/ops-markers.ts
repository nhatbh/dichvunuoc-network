/** Marker lifecycle: Suspected → Under review → Work ordered → Repaired → Closed (Rejected from review; rework from Repaired). */
import { MARKER_TRANSITIONS } from '@wn/contracts/ops'
import type { MarkerAction, MarkerState, OpsMarker } from './ops-types'

const to = (from: MarkerState, action: MarkerAction): MarkerState => {
  const next = MARKER_TRANSITIONS[from][action]
  if (!next) throw new Error(`no ${action} from ${from} in the contract`)
  return next
}

export const MARKER_MOVES: Record<MarkerState, Array<{ action: MarkerAction; to: MarkerState; label: string }>> = {
  suspected: [{ action: 'review', to: to('suspected', 'review'), label: 'Tiếp nhận kiểm tra' }],
  under_review: [
    { action: 'confirm', to: to('under_review', 'confirm'), label: 'Xác nhận · tạo lệnh sửa' },
    { action: 'reject', to: to('under_review', 'reject'), label: 'Không phải rò rỉ' },
  ],
  work_ordered: [{ action: 'repaired', to: to('work_ordered', 'repaired'), label: 'Đã sửa xong' }],
  repaired: [
    { action: 'verify', to: to('repaired', 'verify'), label: 'Số đọc về đường nền · đóng' },
    { action: 'rework', to: to('repaired', 'rework'), label: 'Chưa về đường nền · sửa lại' },
  ],
  rejected: [],
  closed: [],
}

export const MARKER_STATE_LABEL: Record<MarkerState, string> = {
  suspected: 'Nghi ngờ',
  under_review: 'Đang kiểm tra',
  rejected: 'Bác bỏ',
  work_ordered: 'Đã giao sửa',
  repaired: 'Đã sửa',
  closed: 'Đã đóng',
}

export const MARKER_KIND_LABEL: Record<OpsMarker['kind'], string> = {
  suspected_leak: 'Nghi rò rỉ',
  confirmed_leak: 'Rò rỉ xác nhận',
  maintenance: 'Bảo trì',
  sensor_fault: 'Lỗi cảm biến',
}

export const isOpen = (m: OpsMarker) => m.state !== 'closed' && m.state !== 'rejected'

/** Apply a lifecycle move; returns null when the move is not allowed from the marker's state. */
export function moveMarker(m: OpsMarker, action: MarkerAction, by: string, at: string, note?: string): OpsMarker | null {
  const move = MARKER_MOVES[m.state].find(x => x.action === action)
  if (!move) return null
  const kind = action === 'confirm' && m.kind === 'suspected_leak' ? 'confirmed_leak' : m.kind
  const workOrderRef = action === 'confirm' && !m.workOrderRef ? `WO-${m.id.replace(/^MK-/, '')}` : m.workOrderRef
  return {
    ...m,
    kind,
    state: move.to,
    ...(workOrderRef ? { workOrderRef } : {}),
    history: [...m.history, { state: move.to, at, by, ...(note ? { note } : {}) }],
  }
}
