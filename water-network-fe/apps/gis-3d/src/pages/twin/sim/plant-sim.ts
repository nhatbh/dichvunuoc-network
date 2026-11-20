/**
 * Mock real-time process model of the Sông Hồng plant + TB1 intake (frontend only, deterministic seed).
 *
 * Water path: river → TB1 (3 × 1450 m³/h) → raw-water pond (sơ lắng) → transfer PS (3 × 750 m³/h) →
 * mixing + 3-stage flocculation + 2 lamella settlers → 4 sand filters → 10,000 m³ reservoir →
 * clean-water PS (3 × 850 m³/h @ 50 m, VFD) → D1000 → distribution (the Vĩnh Thịnh zone is one share).
 * Chemicals: PAC + polymer before mixing, pre-chlorination at the inlet, disinfection at the reservoir.
 *
 * It is a demo model: mass balances and pump curves are physical enough to react sensibly to commands
 * (stop pumps → pressure falls on the map; close MV-701 → dead-head alarm; dirty filters → backwash),
 * nothing more.
 */
import { EQUIPMENT, type Equipment } from '../data/plant-model'

export type Mode = 'auto' | 'man'
export type FilterPhase = 'filter' | 'drain' | 'air' | 'airwater' | 'rinse' | 'refill' | 'standby'

export interface DeviceState {
  tag: string
  mode: Mode
  run: boolean
  fault: boolean
  /** VFD frequency (Hz), mixer speed (%), dosing setpoint (mg/L), chlorinator (kg/h) */
  sp: number
  /** valve opening 0..1 and its commanded target */
  open: number
  target: number
  /** filter phase, phase time (s), head loss (m), run time since wash (h) */
  phase: FilterPhase
  phaseT: number
  headloss: number
  runH: number
  /** live outputs */
  q: number
  h: number
  kw: number
  hours: number
}

export interface Alarm {
  id: string
  t: number
  level: 'crit' | 'warn' | 'info'
  tag: string
  msg: string
  active: boolean
  acked: boolean
}

export interface LogEntry {
  t: number
  tag: string
  msg: string
  who: 'op' | 'auto' | 'sys'
}

export interface ZoneSupply {
  /** piezometric head available at the Vĩnh Thịnh entry node (m) */
  head: number
  /** zone demand served (m³/h) and requested */
  q: number
  qDemand: number
  /** chlorine residual leaving the plant (mg/L) */
  cl: number
}

const RESERVOIR_AREA = 40 * 46.8
const RESERVOIR_H = 5.3
const POND_AREA = 9_500
const POND_H = 4.6
const RATED = 1208 // 29,000 m³/ngđ
const ZONE_SHARE = 0.11 // Vĩnh Thịnh đợt 3 of the plant's demand
const DIURNAL = [0.56, 0.5, 0.47, 0.49, 0.6, 0.86, 1.14, 1.3, 1.22, 1.1, 1.05, 1.1, 1.16, 1.06, 1.0, 1.0, 1.06, 1.22, 1.36, 1.3, 1.15, 0.96, 0.8, 0.66]

const PHASES: Array<{ id: FilterPhase; s: number; label: string }> = [
  { id: 'drain', s: 180, label: 'Hạ mực nước' },
  { id: 'air', s: 180, label: 'Sục khí' },
  { id: 'airwater', s: 240, label: 'Rửa gió + nước' },
  { id: 'rinse', s: 360, label: 'Rửa nước' },
  { id: 'refill', s: 240, label: 'Làm đầy' },
]
export const PHASE_LABEL: Record<FilterPhase, string> = {
  filter: 'Đang lọc',
  standby: 'Chờ',
  drain: 'Rửa · hạ mực nước',
  air: 'Rửa · sục khí',
  airwater: 'Rửa · gió + nước',
  rinse: 'Rửa · nước',
  refill: 'Rửa · làm đầy',
}

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const approach = (x: number, target: number, rate: number, dt: number) => x + (target - x) * (1 - Math.exp(-dt / rate))

export const fmtClock = (t: number) => {
  const s = Math.floor(t) % 86400
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

export class PlantSim {
  /** seconds since the simulation's day 0 (the warm-up runs day 0, the demo starts on day 1 at 07:20) */
  t = 86400 + 7 * 3600 + 20 * 60
  day = 0
  speed = 10
  paused = false
  readonly dev: Record<string, DeviceState> = {}
  readonly alarms: Alarm[] = []
  readonly log: LogEntry[] = []

  // process variables
  riverLevel = 7.4
  rawTurb = 55
  flood = 0
  pondLevel = 3.4
  reservoirLevel = 3.6
  settledTurb = 2.2
  filteredTurb = 0.18
  clRes = 0.62
  pacDose = 16
  /** plant outputs */
  qRaw = 0
  qTransfer = 0
  qFiltered = 0
  qOut = 0
  qBackwash = 0
  qDemand = 0
  pOut = 4.1
  powerKw = 0
  prodToday = 0
  kwhToday = 0
  /** dead-head time of the outlet (s) */
  deadhead = 0
  /** chlorine leak (ppm) */
  leak = 0
  /** network valves closed from the map (asset codes) */
  readonly closedNetValves = new Set<string>()

  /** last 24 h, one sample per 5 sim-minutes */
  readonly history: Record<'pOut' | 'qOut' | 'res' | 'turb' | 'cl' | 'raw', number[]> = { pOut: [], qOut: [], res: [], turb: [], cl: [], raw: [] }
  #histT = 0
  #rand = rng(20261120)
  #listeners = new Set<() => void>()
  #alarmSeq = 0
  #pi = { ns: 0, ct: 0 }

  constructor() {
    for (const e of EQUIPMENT) this.dev[e.tag] = this.#initial(e)
    // a plausible morning: two clean-water pumps, two transfer pumps, one TB1 pump, filter 3 nearly due
    this.#set('P-NS-01', { run: true, sp: 46 })
    this.#set('P-NS-02', { run: true, sp: 46 })
    this.#set('P-CT-01', { run: true, sp: 47 })
    this.#set('P-CT-02', { run: true, sp: 47 })
    this.#set('P-TB1-01', { run: true, sp: 48 })
    ;['F-501', 'F-502', 'F-503', 'F-504'].forEach((f, i) => this.#set(f, { headloss: [0.7, 1.25, 1.95, 0.35][i]!, runH: [18, 31, 44, 6][i]! }))
    // fill the 24 h history so the charts start full
    const t0 = this.t
    this.t = t0 - 86400
    this.speed = 1
    for (let s = 0; s < 86400; s += 20) this.#step(20, true)
    this.t = t0
    this.prodToday = this.qOut * 7.3
    this.kwhToday = this.powerKw * 7.3
    this.alarms.length = 0
    this.log.length = 0
    this.speed = 10
    this.#log('SYSTEM', 'Kết nối SCADA nhà máy · dữ liệu mô phỏng', 'sys')
  }

  #initial(e: Equipment): DeviceState {
    return {
      tag: e.tag,
      mode: 'auto',
      run: e.kind === 'mixer' || e.kind === 'flocculator' || e.kind === 'dosing' || e.kind === 'chlorinator',
      fault: false,
      sp:
        e.kind === 'dosing'
          ? e.tag.includes('POL')
            ? 0.25
            : 16
          : e.kind === 'chlorinator'
            ? e.tag === 'CL-901'
              ? 1.2
              : 1.1
            : e.kind === 'mixer' || e.kind === 'flocculator'
              ? 100
              : 48,
      open: e.kind === 'valve' ? 1 : 0,
      target: e.kind === 'valve' ? 1 : 0,
      phase: e.kind === 'filter' ? 'filter' : 'standby',
      phaseT: 0,
      headloss: 0.5,
      runH: 10,
      q: 0,
      h: 0,
      kw: 0,
      hours: 1200 + Math.round(e.tag.length * 377 + e.tag.charCodeAt(e.tag.length - 1) * 31),
    }
  }
  #set(tag: string, p: Partial<DeviceState>) {
    Object.assign(this.dev[tag]!, p)
  }

  subscribe(cb: () => void) {
    this.#listeners.add(cb)
    return () => this.#listeners.delete(cb)
  }

  /** Advance by `realDt` seconds of wall time. */
  advance(realDt: number) {
    if (this.paused) return
    let left = Math.min(realDt, 0.5) * this.speed
    while (left > 1e-6) {
      const dt = Math.min(left, 5)
      this.#step(dt, false)
      left -= dt
    }
    this.#listeners.forEach(cb => cb())
  }

  get clock() {
    return fmtClock(this.t)
  }
  get demandFactor() {
    const h = (((this.t / 3600) % 24) + 24) % 24
    const i = Math.floor(h)
    const f = h - i
    return DIURNAL[i]! * (1 - f) + DIURNAL[(i + 1) % 24]! * f
  }

  #step(dt: number, warm: boolean) {
    this.t += dt
    if (this.t >= 86400 * (this.day + 1)) {
      this.day++
      this.prodToday = 0
      this.kwhToday = 0
    }
    const r = this.#rand
    const hour = (((this.t / 3600) % 24) + 24) % 24

    // ── river ──
    this.riverLevel = 7.4 + 0.45 * Math.sin((this.t / 86400) * 2 * Math.PI * 0.7) + (r() - 0.5) * 0.004
    this.flood = Math.max(0, this.flood - dt / (6 * 3600))
    const rawBase = 55 + 20 * Math.sin(this.t / 30000) + 8 * Math.sin(this.t / 5100)
    this.rawTurb = approach(this.rawTurb, rawBase * (1 + 3.2 * this.flood), 600, dt)

    // ── TB1 raw-water pumps (AUTO keeps the pond between 3.0 and 4.0 m) ──
    const tb1 = ['P-TB1-01', 'P-TB1-02', 'P-TB1-03'].map(t => this.dev[t]!)
    const autoTb1 = tb1.filter(d => d.mode === 'auto' && !d.fault)
    const wantTb1 = this.pondLevel < 2.4 ? 2 : this.pondLevel < 3.0 ? 1 : this.pondLevel > 4.0 ? 0 : -1
    if (wantTb1 >= 0) this.#dutyCount(autoTb1, wantTb1 - tb1.filter(d => d.mode === 'man' && d.run && !d.fault).length, 'TB1')
    this.qRaw = 0
    for (const d of tb1) {
      const on = d.run && !d.fault
      if (d.mode === 'auto') d.sp = approach(d.sp, this.pondLevel > 3.7 ? 44 : 49, 120, dt)
      d.q = on ? 1450 * (d.sp / 50) * (this.riverLevel > 2.2 ? 1 : 0.5) : 0
      d.h = on ? 45 * (d.sp / 50) ** 2 : 0
      d.kw = on ? (9.81 * (d.q / 3600) * d.h) / 0.78 : 0
      this.qRaw += d.q
    }

    // ── transfer pumps (AUTO holds the reservoir near 75 %) ──
    const ct = ['P-CT-01', 'P-CT-02', 'P-CT-03'].map(t => this.dev[t]!)
    const resPct = this.reservoirLevel / RESERVOIR_H
    const err = resPct - 0.75
    this.#pi.ct = clamp(this.#pi.ct - err * dt * 0.02, -8, 8)
    const autoFreq = clamp(47 - err * 40 + this.#pi.ct, 35, 50)
    const autoCt = ct.filter(d => d.mode === 'auto' && !d.fault)
    this.#dutyCount(autoCt, (resPct > 0.95 ? 1 : 2) - ct.filter(d => d.mode === 'man' && d.run && !d.fault).length, 'CT')
    const lamellaOpen = ['MV-401', 'MV-402'].reduce((s, t) => s + this.dev[t]!.open, 0)
    let qCt = 0
    for (const d of ct) {
      if (d.run && this.pondLevel < 0.6 && !d.fault) this.#trip(d, 'Mực nước hồ sơ lắng thấp – dừng bảo vệ')
      if (d.mode === 'auto') d.sp = approach(d.sp, autoFreq, 60, dt)
      const on = d.run && !d.fault
      d.q = on ? 750 * (d.sp / 50) : 0
      qCt += d.q
    }
    const cap = lamellaOpen * 950
    const scale = qCt > 0 ? Math.min(1, cap / qCt) : 0
    for (const d of ct) {
      d.q *= scale
      d.h = d.q > 0 ? 20 * (d.sp / 50) ** 2 + (scale < 1 ? 6 * (1 - scale) : 0) : 0
      d.kw = d.q > 0 ? (9.81 * (d.q / 3600) * d.h) / 0.75 : d.run && !d.fault ? 18 : 0
    }
    this.qTransfer = qCt * scale

    // ── pond balance ──
    this.pondLevel = clamp(this.pondLevel + ((this.qRaw - this.qTransfer) / 3600 / POND_AREA) * dt, 0, POND_H)

    // ── chemicals + clarification ──
    const required = 8 + 0.13 * this.rawTurb
    const pac = ['DP-PAC-01', 'DP-PAC-02'].map(t => this.dev[t]!)
    for (const d of pac) {
      d.kw = d.run && !d.fault ? 0.37 : 0
    }
    const pacOn = pac.filter(d => d.run && !d.fault)
    // AUTO dose follows the raw turbidity (jar-test curve); MAN keeps the operator's mg/L
    for (const d of pacOn) if (d.mode === 'auto') d.sp = approach(d.sp, required * 1.05, 900, dt)
    this.pacDose = pacOn.length ? Math.max(...pacOn.map(d => d.sp)) : 0
    const pol = this.dev['DP-POL-01']!
    const polOk = pol.run && !pol.fault ? 1 : 0.85
    const mixOk = this.dev['M-401']!.run && !this.dev['M-401']!.fault ? 1 : 0.6
    const flocOk = ['FL-401', 'FL-402', 'FL-403'].reduce((s, t) => s + (this.dev[t]!.run && !this.dev[t]!.fault ? 1 : 0), 0) / 3
    for (const t of ['M-401', 'FL-401', 'FL-402', 'FL-403']) this.dev[t]!.kw = this.dev[t]!.run && !this.dev[t]!.fault ? (t === 'M-401' ? 5.5 : 4) * (this.dev[t]!.sp / 100) : 0
    const eff = clamp(this.pacDose / required, 0, 1.4) * mixOk * (0.55 + 0.45 * flocOk) * polOk
    const loadPerLamella = lamellaOpen > 0 ? this.qTransfer / lamellaOpen : 0
    const overload = clamp((loadPerLamella - 700) / 400, 0, 1)
    const settledTarget = this.rawTurb * (0.025 + 0.45 * Math.max(0, 1 - eff) ** 1.6) * (1 + overload)
    this.settledTurb = approach(this.settledTurb, settledTarget, 1200, dt)
    for (const t of ['LS-401', 'LS-402']) {
      const d = this.dev[t]!
      d.q = this.dev[t === 'LS-401' ? 'MV-401' : 'MV-402']!.open * loadPerLamella
    }

    // ── filters ──
    const filters = ['F-501', 'F-502', 'F-503', 'F-504'].map(t => this.dev[t]!)
    const washing = filters.find(f => f.phase !== 'filter' && f.phase !== 'standby')
    for (const f of filters) {
      if (f.phase === 'filter' && !washing && f.mode === 'auto' && (f.headloss > 2.2 || f.runH > 48)) {
        this.#startWash(f, 'auto')
        break
      }
    }
    const active = filters.filter(f => f.phase === 'filter')
    const qFilterIn = this.qTransfer * 0.97
    let bwPump = 0
    let blower = 0
    for (const f of filters) {
      if (f.phase === 'filter') {
        f.q = active.length ? qFilterIn / active.length : 0
        f.headloss += (dt / 3600) * (0.012 + 0.0048 * this.settledTurb) * (f.q / 300)
        f.runH += dt / 3600
      } else if (f.phase === 'standby') {
        f.q = 0
      } else {
        f.q = 0
        f.phaseT += dt
        const ph = PHASES.find(p => p.id === f.phase)!
        if (f.phase === 'air' || f.phase === 'airwater') blower = 1
        if (f.phase === 'airwater' || f.phase === 'rinse') bwPump = f.phase === 'rinse' ? 1 : 0.6
        if (f.phaseT >= ph.s) {
          const next = PHASES[PHASES.findIndex(p => p.id === f.phase) + 1]
          f.phaseT = 0
          if (next) f.phase = next.id
          else {
            f.phase = 'filter'
            f.headloss = 0.28 + r() * 0.06
            f.runH = 0
            this.#log(f.tag, 'Hoàn tất rửa lọc, đưa vào lọc', 'auto')
          }
        }
      }
    }
    // backwash pumps / blowers follow the sequence (AUTO), operators can still run them by hand
    const bwPumps = ['P-RL-01', 'P-RL-02'].map(t => this.dev[t]!)
    const blowers = ['B-701', 'B-702'].map(t => this.dev[t]!)
    this.#dutyCount(bwPumps.filter(d => d.mode === 'auto' && !d.fault), bwPump > 0 ? 1 : 0, 'RL', true)
    this.#dutyCount(blowers.filter(d => d.mode === 'auto' && !d.fault), blower > 0 ? 1 : 0, 'B', true)
    this.qBackwash = 0
    for (const d of bwPumps) {
      const on = d.run && !d.fault
      d.q = on ? 1050 * (bwPump || 0.4) : 0
      d.h = on ? 15 : 0
      d.kw = on ? (9.81 * (d.q / 3600) * 15) / 0.72 : 0
      this.qBackwash += d.q
    }
    for (const d of blowers) {
      d.q = d.run && !d.fault ? 75 * 60 : 0
      d.kw = d.q ? 90 : 0
    }
    const worstHl = Math.max(...active.map(f => f.headloss), 0)
    const filtTarget = 0.05 + this.settledTurb * 0.055 + (worstHl > 2.5 ? 0.6 * (worstHl - 2.5) : 0) + (active.length === 0 ? 3 : 0)
    this.filteredTurb = approach(this.filteredTurb, filtTarget, 600, dt)
    this.qFiltered = active.length ? qFilterIn : 0

    // ── chlorination ──
    const cl1 = this.dev['CL-901']!
    const cl2 = this.dev['CL-902']!
    for (const c of [cl1, cl2]) {
      if (c.mode === 'auto') c.sp = c === cl2 ? approach(c.sp, (this.qFiltered * 1.25) / 1000, 300, dt) : approach(c.sp, (this.qTransfer * 1.0) / 1000, 300, dt)
      c.q = c.run && !c.fault ? c.sp : 0
      c.kw = c.q ? 0.2 : 0
    }
    const doseMg = this.qFiltered > 1 ? (cl2.q * 1000) / this.qFiltered : 0
    const clEq = Math.max(0, doseMg - 0.55 + (cl1.q > 0 ? 0.08 : 0))
    const tau = Math.max(1800, ((this.reservoirLevel * RESERVOIR_AREA) / Math.max(this.qFiltered, 200)) * 3600 * 0.4)
    this.clRes = approach(this.clRes, clEq, tau, dt)
    this.leak = this.dev['GD-901']!.fault ? Math.min(6, this.leak + dt * 0.05) : Math.max(0, this.leak - dt * 0.02)
    this.dev['SC-901']!.run = this.leak > 0.5
    this.dev['SC-901']!.kw = this.leak > 0.5 ? 7.5 : 0

    // ── clean-water pumps: VFD PI on the outlet pressure, demand-driven network ──
    this.qDemand = RATED * this.demandFactor * (1 + 0.03 * Math.sin(this.t / 700))
    const ns = ['P-NS-01', 'P-NS-02', 'P-NS-03'].map(t => this.dev[t]!)
    const nsAuto = ns.filter(d => d.mode === 'auto' && !d.fault)
    const need = this.qDemand > 1500 ? 3 : this.qDemand > 650 ? 2 : 1
    this.#dutyCount(nsAuto, need - ns.filter(d => d.mode === 'man' && d.run && !d.fault).length, 'NS')
    const on = ns.filter(d => d.run && !d.fault)
    const valve = this.dev['MV-701']!
    if (this.reservoirLevel < 0.35) for (const d of on) this.#trip(d, 'Mực nước bể chứa cạn – chống chạy khô')
    const spBar = 4.2
    this.#pi.ns = clamp(this.#pi.ns + (spBar - this.pOut) * dt * 0.08, -12, 12)
    for (const d of on) if (d.mode === 'auto') d.sp = clamp(approach(d.sp, 44 + this.#pi.ns, 20, dt), 30, 50)
    const n = on.length
    const fAvg = n ? on.reduce((s, d) => s + d.sp, 0) / n : 0
    const H0 = 62 * (fAvg / 50) ** 2
    const a = 12 / 850 ** 2
    const kTm = 2.2e-7 // D1000 + plant pipework
    const g = (H: number) => clamp(Math.sqrt(Math.max(0, H - 5) / 25), 0, 1)
    let qOut = 0
    if (n && valve.open > 0.02) {
      const valveK = 1 / Math.max(valve.open, 0.02) ** 2
      const hAvail = (Q: number) => H0 - a * (Q / n) ** 2 - kTm * valveK * Q * Q
      let lo = 0
      let hi = this.qDemand
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (mid - this.qDemand * g(hAvail(mid)) > 0) hi = mid
        else lo = mid
      }
      qOut = lo
    }
    this.qOut = qOut
    const hOut = n ? H0 - a * (qOut / Math.max(n, 1)) ** 2 : this.reservoirLevel + 1
    this.pOut = approach(this.pOut, Math.max(0, hOut / 10.2), 8, dt)
    this.deadhead = n && valve.open < 0.05 ? this.deadhead + dt : 0
    if (this.deadhead > 240) for (const d of on) this.#trip(d, 'Chạy kín van (van MV-701 đóng) – quá nhiệt')
    for (const d of ns) {
      const run = d.run && !d.fault
      d.q = run ? qOut / n : 0
      d.h = run ? hOut : 0
      d.kw = run ? (9.81 * (Math.max(d.q, 120) / 3600) * Math.max(hOut, 10)) / 0.8 : 0
      if (run) d.hours += dt / 3600
    }

    // ── valves travel (60 s for DN1000, 30 s for DN600) ──
    for (const v of Object.values(this.dev)) {
      if (!v.tag.startsWith('MV-')) continue
      const travel = v.tag === 'MV-701' ? 60 : 30
      if (!v.fault) v.open = v.target > v.open ? Math.min(v.target, v.open + dt / travel) : Math.max(v.target, v.open - dt / travel)
    }

    // ── reservoir ──
    this.reservoirLevel = clamp(this.reservoirLevel + ((this.qFiltered - this.qOut - this.qBackwash) / 3600 / RESERVOIR_AREA) * dt, 0.05, RESERVOIR_H)

    // ── recovery tank pumps ──
    const th = ['P-TH-01', 'P-TH-02'].map(t => this.dev[t]!)
    const wasteIn = this.qBackwash + this.qTransfer * 0.03
    this.#dutyCount(th.filter(d => d.mode === 'auto' && !d.fault), wasteIn > 200 ? 2 : 1, 'TH')
    for (const d of th) {
      d.q = d.run && !d.fault ? 150 : 0
      d.h = d.q ? 12 : 0
      d.kw = d.q ? 9 : 0
    }

    // ── energy ──
    for (const d of Object.values(this.dev)) if (d.run && !d.fault && d.kw > 0) d.hours += 0
    this.powerKw = Object.values(this.dev).reduce((s, d) => s + d.kw, 0) + 38 + (hour > 18 || hour < 6 ? 12 : 0)
    this.prodToday += (this.qOut * dt) / 3600
    this.kwhToday += (this.powerKw * dt) / 3600

    // ── history ──
    this.#histT += dt
    if (this.#histT >= 300) {
      this.#histT = 0
      const push = (k: keyof PlantSim['history'], v: number) => {
        const a2 = this.history[k]
        a2.push(v)
        if (a2.length > 288) a2.shift()
      }
      push('pOut', this.pOut)
      push('qOut', this.qOut)
      push('res', (this.reservoirLevel / RESERVOIR_H) * 100)
      push('turb', this.filteredTurb)
      push('cl', this.clRes)
      push('raw', this.rawTurb)
    }
    if (!warm) this.#checkAlarms()
  }

  /** Start/stop AUTO units so `want` of them run (the ones with fewest hours first). */
  #dutyCount(auto: DeviceState[], want: number, _group: string, silent = false) {
    want = Math.max(0, Math.min(want, auto.length))
    const running = auto.filter(d => d.run)
    if (running.length < want) {
      const idle = auto.filter(d => !d.run).sort((x, y) => x.hours - y.hours)
      for (const d of idle.slice(0, want - running.length)) {
        d.run = true
        if (!silent) this.#log(d.tag, 'Tự động khởi động', 'auto')
      }
    } else if (running.length > want) {
      const sorted = running.sort((x, y) => y.hours - x.hours)
      for (const d of sorted.slice(0, running.length - want)) {
        d.run = false
        if (!silent) this.#log(d.tag, 'Tự động dừng', 'auto')
      }
    }
  }

  #trip(d: DeviceState, why: string) {
    d.run = false
    this.#raise('crit', d.tag, why)
    this.#log(d.tag, `Dừng bảo vệ: ${why}`, 'sys')
  }

  #startWash(f: DeviceState, who: 'op' | 'auto') {
    f.phase = 'drain'
    f.phaseT = 0
    this.#log(f.tag, `Bắt đầu rửa lọc (tổn thất ${f.headloss.toFixed(2)} m)`, who)
  }

  // ───────────── alarms / log ─────────────
  #raise(level: Alarm['level'], tag: string, msg: string) {
    const existing = this.alarms.find(a => a.tag === tag && a.msg === msg && a.active)
    if (existing) return
    this.alarms.unshift({ id: `A${++this.#alarmSeq}`, t: this.t, level, tag, msg, active: true, acked: false })
    if (this.alarms.length > 60) this.alarms.pop()
  }
  #clear(tag: string, msg: string) {
    for (const a of this.alarms) if (a.tag === tag && a.msg === msg && a.active) a.active = false
  }
  #cond(on: boolean, level: Alarm['level'], tag: string, msg: string) {
    if (on) this.#raise(level, tag, msg)
    else this.#clear(tag, msg)
  }
  #checkAlarms() {
    const resPct = this.reservoirLevel / RESERVOIR_H
    this.#cond(resPct < 0.08, 'crit', 'LT-601', 'Mực nước bể chứa rất thấp')
    this.#cond(resPct >= 0.08 && resPct < 0.2, 'warn', 'LT-601', 'Mực nước bể chứa thấp')
    this.#cond(this.pOut < 2.5, 'crit', 'PT-701', 'Áp lực đầu ra thấp < 2,5 bar')
    this.#cond(this.pOut > 5.6, 'warn', 'PT-701', 'Áp lực đầu ra cao > 5,6 bar')
    this.#cond(this.filteredTurb > 2, 'crit', 'AIT-501', 'Độ đục sau lọc vượt QCVN (> 2 NTU)')
    this.#cond(this.filteredTurb > 1 && this.filteredTurb <= 2, 'warn', 'AIT-501', 'Độ đục sau lọc tăng (> 1 NTU)')
    this.#cond(this.clRes < 0.3, 'warn', 'AIT-601', 'Clo dư thấp < 0,3 mg/L')
    this.#cond(this.clRes > 1.0, 'warn', 'AIT-601', 'Clo dư cao > 1,0 mg/L')
    this.#cond(this.leak > 1, 'crit', 'GD-901', 'Rò rỉ clo trong nhà clo')
    this.#cond(this.pondLevel < 1.2, 'warn', 'LT-201', 'Mực nước hồ sơ lắng thấp')
    this.#cond(this.rawTurb > 180, 'warn', 'AIT-201', 'Độ đục nước thô cao (lũ)')
    this.#cond(this.deadhead > 20, 'warn', 'MV-701', 'Bơm nước sạch chạy khi van ra đóng')
    for (const d of Object.values(this.dev)) this.#cond(d.fault, 'crit', d.tag, 'Sự cố thiết bị')
  }

  #log(tag: string, msg: string, who: LogEntry['who']) {
    this.log.unshift({ t: this.t, tag, msg, who })
    if (this.log.length > 120) this.log.pop()
  }

  // ───────────── commands (operator) ─────────────
  command(tag: string, action: 'start' | 'stop' | 'auto' | 'man' | 'open' | 'close' | 'sp' | 'wash' | 'reset' | 'fault', value?: number) {
    const d = this.dev[tag]
    if (!d) return
    switch (action) {
      case 'auto':
      case 'man':
        d.mode = action
        this.#log(tag, action === 'auto' ? 'Chuyển chế độ TỰ ĐỘNG' : 'Chuyển chế độ TAY', 'op')
        break
      case 'start':
        if (d.fault) return
        d.run = true
        if (d.mode === 'auto') d.mode = 'man'
        this.#log(tag, 'Lệnh CHẠY', 'op')
        break
      case 'stop':
        d.run = false
        if (d.mode === 'auto') d.mode = 'man'
        this.#log(tag, 'Lệnh DỪNG', 'op')
        break
      case 'open':
      case 'close':
        d.target = action === 'open' ? 1 : 0
        if (d.mode === 'auto') d.mode = 'man'
        this.#log(tag, action === 'open' ? 'Lệnh MỞ van' : 'Lệnh ĐÓNG van', 'op')
        break
      case 'sp':
        if (value === undefined) return
        d.sp = value
        if (d.mode === 'auto') d.mode = 'man'
        this.#log(tag, `Đặt giá trị ${value.toFixed(value < 5 ? 2 : 1)}`, 'op')
        break
      case 'wash':
        if (d.phase === 'filter' || d.phase === 'standby') {
          if (Object.values(this.dev).some(f => f.tag.startsWith('F-') && f.phase !== 'filter' && f.phase !== 'standby')) {
            this.#log(tag, 'Từ chối rửa: đang có bể khác rửa', 'sys')
            return
          }
          this.#startWash(d, 'op')
        }
        break
      case 'reset':
        d.fault = false
        this.#log(tag, 'Đặt lại sự cố', 'op')
        break
      case 'fault':
        d.fault = true
        d.run = false
        this.#log(tag, 'Mô phỏng sự cố thiết bị', 'sys')
        break
    }
    this.#checkAlarms()
    this.#listeners.forEach(cb => cb())
  }

  injectFlood() {
    this.flood = 1
    this.#log('AIT-201', 'Mô phỏng lũ: độ đục nước thô tăng mạnh', 'sys')
  }
  injectLeak() {
    this.dev['GD-901']!.fault = true
    this.#log('GD-901', 'Mô phỏng rò rỉ clo', 'sys')
  }
  ackAll() {
    for (const a of this.alarms) a.acked = true
    this.#listeners.forEach(cb => cb())
  }
  toggleNetValve(code: string) {
    if (this.closedNetValves.has(code)) this.closedNetValves.delete(code)
    else this.closedNetValves.add(code)
    this.#log(code, this.closedNetValves.has(code) ? 'Đóng van mạng lưới' : 'Mở van mạng lưới', 'op')
    this.#listeners.forEach(cb => cb())
  }

  get zone(): ZoneSupply {
    const qDemand = this.qDemand * ZONE_SHARE
    const served = this.qDemand > 0 ? this.qOut / this.qDemand : 0
    // 2.4 km D1000 then the DN315 into the zone: head at the entry node
    const head = Math.max(0, this.pOut * 10.2 - 1.6 * (this.qOut / RATED) ** 2 - 1.5)
    return { head, q: qDemand * served, qDemand, cl: this.clRes }
  }

  get activeAlarms() {
    return this.alarms.filter(a => a.active)
  }
  get unacked() {
    return this.alarms.filter(a => !a.acked && a.active).length
  }
  get specificEnergy() {
    return this.qOut > 1 ? (this.powerKw - 38) / this.qOut : 0
  }
  get reservoirPct() {
    return (this.reservoirLevel / RESERVOIR_H) * 100
  }

  /** Readings shown on a faceplate / label. */
  readings(tag: string): Array<{ k: string; v: string; u?: string; warn?: boolean }> {
    const d = this.dev[tag]
    const f1 = (v: number) => v.toFixed(1).replace('.', ',')
    const f2 = (v: number) => v.toFixed(2).replace('.', ',')
    const out: Array<{ k: string; v: string; u?: string; warn?: boolean }> = []
    const kind = EQUIPMENT.find(e => e.tag === tag)?.kind
    if (!d) return out
    switch (kind) {
      case 'pump':
      case 'subpump':
        out.push({ k: 'Lưu lượng', v: f1(d.q), u: 'm³/h' }, { k: 'Cột áp', v: f1(d.h), u: 'm' }, { k: 'Công suất', v: f1(d.kw), u: 'kW' })
        if (kind === 'pump') out.push({ k: 'Tần số', v: f1(d.run ? d.sp : 0), u: 'Hz' })
        out.push({ k: 'Giờ chạy', v: Math.round(d.hours).toLocaleString('vi-VN'), u: 'h' })
        break
      case 'blower':
        out.push({ k: 'Lưu lượng khí', v: f1(d.q / 60), u: 'm³/ph' }, { k: 'Công suất', v: f1(d.kw), u: 'kW' })
        break
      case 'valve':
        out.push({ k: 'Độ mở', v: Math.round(d.open * 100) + '', u: '%' }, { k: 'Lệnh', v: d.target > 0.5 ? 'MỞ' : 'ĐÓNG' })
        break
      case 'mixer':
      case 'flocculator':
        out.push({ k: 'Tốc độ', v: Math.round(d.run ? d.sp : 0) + '', u: '%' }, { k: 'Công suất', v: f1(d.kw), u: 'kW' })
        break
      case 'lamella':
        out.push({ k: 'Lưu lượng', v: f1(d.q), u: 'm³/h' }, { k: 'Tải bề mặt', v: f2(d.q / 172), u: 'm/h' }, { k: 'Độ đục ra', v: f2(this.settledTurb), u: 'NTU', warn: this.settledTurb > 5 })
        break
      case 'filter':
        out.push(
          { k: 'Trạng thái', v: PHASE_LABEL[d.phase] },
          { k: 'Lưu lượng', v: f1(d.q), u: 'm³/h' },
          { k: 'Tổn thất áp', v: f2(d.headloss), u: 'm', warn: d.headloss > 2.2 },
          { k: 'Thời gian lọc', v: f1(d.runH), u: 'h' },
        )
        break
      case 'dosing':
        out.push({ k: 'Liều lượng', v: f1(d.run && !d.fault ? d.sp : 0), u: 'mg/L' }, { k: 'Yêu cầu (jar test)', v: f1(8 + 0.13 * this.rawTurb), u: 'mg/L' })
        break
      case 'chlorinator':
        out.push({ k: 'Lượng clo', v: f2(d.q), u: 'kg/h' })
        break
      case 'cylinders':
        out.push({ k: 'Clo còn lại', v: f1(6.2 - (this.t % 86400) / 86400), u: 't' }, { k: 'Bình đang dùng', v: '2 / 10' })
        break
      case 'leak':
        out.push({ k: 'Nồng độ Cl₂', v: f2(this.leak), u: 'ppm', warn: this.leak > 1 })
        break
      case 'scrubber':
        out.push({ k: 'Trạng thái', v: d.run ? 'ĐANG TRUNG HÒA' : 'Chờ' })
        break
      case 'tank':
        out.push({ k: 'Mức', v: f1(62 + 20 * Math.sin(this.t / 9000 + tag.length)), u: '%' })
        break
      case 'transformer':
        out.push({ k: 'Phụ tải', v: f1(this.powerKw), u: 'kW' }, { k: 'Hệ số tải', v: f1((this.powerKw / 1600 / 0.9) * 100), u: '%' })
        break
      case 'scada':
        out.push({ k: 'Tag trực tuyến', v: '1.284' }, { k: 'Báo động', v: String(this.activeAlarms.length) })
        break
      default:
        break
    }
    // instruments
    const inst: Record<string, Array<{ k: string; v: string; u?: string; warn?: boolean }>> = {
      'LT-101': [{ k: 'Mực nước sông', v: '+' + f2(this.riverLevel), u: 'm' }],
      'FT-101': [{ k: 'Lưu lượng', v: f1(this.qRaw), u: 'm³/h' }],
      'LT-201': [{ k: 'Mực nước', v: f2(this.pondLevel), u: 'm', warn: this.pondLevel < 1.2 }],
      'AIT-201': [{ k: 'Độ đục', v: f1(this.rawTurb), u: 'NTU', warn: this.rawTurb > 180 }],
      'LT-301': [{ k: 'Mực nước', v: f2(Math.min(4.4, this.pondLevel + 0.4)), u: 'm' }],
      'AIT-401': [{ k: 'Độ đục', v: f2(this.settledTurb), u: 'NTU', warn: this.settledTurb > 5 }],
      'AIT-501': [{ k: 'Độ đục', v: f2(this.filteredTurb), u: 'NTU', warn: this.filteredTurb > 1 }],
      'LT-601': [
        { k: 'Mực nước', v: f2(this.reservoirLevel), u: 'm', warn: this.reservoirPct < 20 },
        { k: 'Thể tích', v: Math.round(this.reservoirLevel * RESERVOIR_AREA).toLocaleString('vi-VN'), u: 'm³' },
      ],
      'AIT-601': [{ k: 'Clo dư', v: f2(this.clRes), u: 'mg/L', warn: this.clRes < 0.3 || this.clRes > 1 }],
      'FT-701': [{ k: 'Lưu lượng', v: f1(this.qOut), u: 'm³/h' }, { k: 'Sản lượng hôm nay', v: Math.round(this.prodToday).toLocaleString('vi-VN'), u: 'm³' }],
      'PT-701': [{ k: 'Áp lực', v: f2(this.pOut), u: 'bar', warn: this.pOut < 2.5 }],
      'LT-1001': [{ k: 'Mực nước', v: f2(1.2 + 0.6 * Math.sin(this.t / 2000)), u: 'm' }],
    }
    return out.concat(inst[tag] ?? [])
  }
}
