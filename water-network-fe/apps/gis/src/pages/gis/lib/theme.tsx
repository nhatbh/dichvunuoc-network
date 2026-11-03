/* Bản đồ mạng lưới GIS — theme + design helpers (SolidJS port of ui.jsx runtime).
   The design keeps theme state in `window.GISUI = { theme, tweaks }` and exposes
   pure helpers (chex/cAccent/tone/lighten/cnorm/rad). We replicate that contract
   with a Solid signal-backed module store so helpers stay call-site-identical
   (`tone("#D1242F")`, `cAccent()`, `rad()`) while the shell drives reactivity. */
import { createContext, createSignal, useContext, type Accessor, type JSX } from 'solid-js'

export type ThemeName = 'light' | 'dark'
export interface Tweaks {
  accent: [string, string]
  dark: boolean
  density: 'compact' | 'regular' | 'comfy'
  radius: number
}

export const TWEAK_DEFAULTS: Tweaks = {
  accent: ['#0E7C86', '#56C7D6'],
  dark: false,
  density: 'regular',
  radius: 9,
}

/* ── Module-level reactive store (mirrors window.GISUI) ──────────────────────
   Read by the pure helpers below. Set once by ThemeProvider so a single source
   of truth drives both the helpers and component reactivity. */
const [tweaks, setTweaksSignal] = createSignal<Tweaks>({ ...TWEAK_DEFAULTS })
export const gisTweaks = tweaks
export const cTheme = (): ThemeName => (tweaks().dark ? 'dark' : 'light')
export const cTw = () => tweaks()

const LIGHTEN: Record<string, string> = {
  '#1A7F37': '#3FB950',
  '#0969DA': '#58A6FF',
  '#8250DF': '#A371F7',
  '#9A6700': '#E3B341',
  '#D1242F': '#F85149',
  '#7E8997': '#9aa4b1',
  '#0E7C86': '#56C7D6',
  '#D86C1F': '#E8893E',
  '#8B949E': '#9aa4b1',
}

export function chex(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
export function lighten(hex: string): string {
  return LIGHTEN[hex] || hex
}
export function cAccent(): string {
  const a = cTw().accent
  const pair = Array.isArray(a) ? a : (['#0E7C86', '#56C7D6'] as [string, string])
  return pair[cTheme() === 'light' ? 0 : 1]
}
export function tone(hex: string): string {
  return cTheme() === 'light' ? hex : lighten(hex)
}
export function cnorm(s?: string): string {
  return (s || '').toLowerCase().normalize('NFC')
}
export function rad(): number {
  return cTw().radius != null ? cTw().radius : 9
}

/* ── Formatters (mirror window.fmtInt/fmtDec/fmtKm) ── */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('vi-VN')
export const fmtDec = (n: number, d = 1): string =>
  Number(n).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d })
export const fmtKm = (m: number): string =>
  m >= 1000
    ? (m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' km'
    : Math.round(m) + ' m'

/* ── Provider / context ── */
interface ThemeCtx {
  theme: Accessor<ThemeName>
  tweaks: Accessor<Tweaks>
  setTheme: (t: ThemeName) => void
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void
}
const Ctx = createContext<ThemeCtx>()

export function ThemeProvider(props: { children: JSX.Element; initial?: Partial<Tweaks> }) {
  if (props.initial) setTweaksSignal((t) => ({ ...t, ...props.initial }))
  const setTweak = <K extends keyof Tweaks>(k: K, v: Tweaks[K]) =>
    setTweaksSignal((t) => ({ ...t, [k]: v }))
  const setTheme = (t: ThemeName) => setTweak('dark', t === 'dark')
  const value: ThemeCtx = {
    theme: cTheme,
    tweaks,
    setTheme,
    setTweak,
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTheme must be used within ThemeProvider')
  return c
}
