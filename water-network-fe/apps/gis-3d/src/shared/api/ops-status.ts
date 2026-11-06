/**
 * Sensor status at a time slot, the same everywhere (map rings, lists, alarms):
 * the worst of — no data (grey), outside its limits or an open leak event (red), outside its
 * baseline band for two readings in a row (amber), else normal (green).
 */
import type { OpsAlarm, OpsEvent, OpsSeries, OpsStatus } from './ops-types'

const RANK: Record<OpsStatus, number> = { normal: 0, warning: 1, critical: 2, offline: 3 }
export const worst = (a: OpsStatus, b: OpsStatus): OpsStatus => (RANK[b] > RANK[a] ? b : a)

/** Level of an event on a sensor at a slot (events stay open to the end of the demo day). */
function eventLevel(sensorId: string, slot: number, events: readonly OpsEvent[]): 'warning' | 'critical' | null {
  let out: 'warning' | 'critical' | null = null
  for (const e of events) {
    if (slot < e.fromSlot) continue
    const hit = e.seenBy.find(s => s.sensorId === sensorId)
    if (hit && (hit.level === 'critical' || !out)) out = hit.level
  }
  return out
}

const outside = (s: OpsSeries, k: number): boolean => {
  const v = s.values[k]
  return v !== undefined && (v < s.p10![k]! || v > s.p90![k]!)
}

export function statusAt(s: OpsSeries, slot: number, events: readonly OpsEvent[] = []): OpsStatus {
  if (slot >= s.values.length) return 'offline'
  const v = s.values[slot]!
  let st: OpsStatus = 'normal'
  if ((s.low !== undefined && v < s.low) || (s.high !== undefined && v > s.high)) st = 'critical'
  const ev = eventLevel(s.sensorId, slot, events)
  if (ev) st = worst(st, ev)
  // outside the band for two readings in a row (one stray reading is not an alarm)
  if (s.p10 && s.p90 && outside(s, slot) && (slot === 0 || outside(s, slot - 1))) st = worst(st, 'warning')
  return st
}

/** Baseline band around an expected day: ±4 %, at least `minAbs`. */
export function bandAround(p50: readonly number[], minAbs: number, digits = 2): { p10: number[]; p90: number[] } {
  const k = 10 ** digits
  const half = (v: number) => Math.max(Math.abs(v) * 0.04, minAbs)
  return {
    p10: p50.map(v => Math.round((v - half(v)) * k) / k),
    p90: p50.map(v => Math.round((v + half(v)) * k) / k),
  }
}

/** Alarms for one sensor's day: each run of slots outside normal becomes one alarm. */
export function alarmsFor(s: OpsSeries, events: readonly OpsEvent[], name: string): OpsAlarm[] {
  const out: OpsAlarm[] = []
  const n = 96
  let run: { st: OpsStatus; from: number } | null = null
  const close = (to: number | undefined) => {
    if (!run || run.st === 'normal') return
    const slot = run.from
    const v = s.values[slot]
    const ev = eventLevel(s.sensorId, slot, events)
    const rule: OpsAlarm['rule'] =
      run.st === 'offline'
        ? 'no_data'
        : ev
          ? 'leak'
          : v !== undefined && ((s.low !== undefined && v < s.low) || (s.high !== undefined && v > s.high))
            ? 'limit'
            : 'baseline'
    const message =
      rule === 'no_data'
        ? `${name}: mất dữ liệu`
        : rule === 'leak'
          ? `${name}: lưu lượng tăng bất thường (nghi rò rỉ)`
          : rule === 'limit'
            ? `${name}: vượt ngưỡng ${s.low !== undefined && v! < s.low ? 'dưới' : 'trên'}`
            : `${name}: lệch khỏi đường nền`
    out.push({
      id: `AL-${s.sensorId}-${slot}`,
      sensorId: s.sensorId,
      rule,
      severity: run.st === 'critical' ? 'critical' : 'warning',
      startSlot: slot,
      ...(to !== undefined ? { endSlot: to } : {}),
      message,
    })
  }
  for (let k = 0; k < n; k++) {
    const st = statusAt(s, k, events)
    if (!run || st !== run.st) {
      close(k - 1)
      run = { st, from: k }
    }
  }
  close(undefined)
  return out
}
