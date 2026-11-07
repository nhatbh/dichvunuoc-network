/* Shared look of the water network on the 3D map (viewer + editor): pipe colours, widths,
   real-size 3D tubes and the water-flow animation (EPANET result or pressure estimate). */
import type { FeatureStyle3D } from '@wn/map-runtime-3d'
import { flowSpeedFromVelocity, type PipeFlow } from '@/shared/lib/hydraulics/epanet-flow'
import type { GisData, Pipe } from '../lib/gis-data'
import { lighten, type ThemeName } from '../lib/theme'

export const PAINT_MAT: Record<string, string> = {
  'Gang dẻo': '#0E7C86',
  HDPE: '#1A7F37',
  uPVC: '#0969DA',
  Thép: '#8250DF',
  'Gang xám': '#9A6700',
}

/** Real-world sizes are tiny on a city map, so 3D tubes and fittings are drawn at a fixed multiple of
 * true size (1 = exact). Pipe diameter comes from the asset's DN. */
export const PIPE_3D_SCALE = 10.4
export const FITTING_3D_SCALE = 6

/* ── pipe color (mirrors network-map.tsx pipeColor exactly) ── */
export function pipeColor(
  p: Pick<Pipe, 'status' | 'material' | 'cond' | 'dma' | 'dn' | 'year' | 'trunk'>,
  theme: ThemeName,
  paint: { mode?: string } | undefined,
  G: GisData
): string {
  const t = (h: string) => (theme === 'light' ? h : lighten(h))
  const mode = paint && paint.mode
  if (mode && mode !== 'status') {
    if (p.status === 'abandoned') return theme === 'light' ? '#C2CAD3' : '#4a5260'
    if (mode === 'material') return t(PAINT_MAT[p.material] || '#7E8997')
    if (mode === 'cond') return t((G.COND[p.cond] || { col: '#7E8997' }).col || '#7E8997')
    if (mode === 'dma')
      return t((G.dmas.find(d => d.id === p.dma) || { col: '#7E8997' }).col || '#7E8997')
    if (mode === 'dn') {
      const d = p.dn
      return t(
        d >= 500
          ? '#8250DF'
          : d >= 300
            ? '#0969DA'
            : d >= 200
              ? '#0E7C86'
              : d >= 150
                ? '#1A7F37'
                : '#9A6700'
      )
    }
    if (mode === 'age') {
      if (!p.year) return t('#7E8997')
      const a = 2026 - p.year
      return t(a > 30 ? '#D1242F' : a > 18 ? '#D86C1F' : a > 8 ? '#9A6700' : '#1A7F37')
    }
  }
  if (p.status === 'leak') return t('#D1242F')
  if (p.status === 'planned') return theme === 'light' ? '#8A9BB0' : '#8193A8'
  if (p.status === 'abandoned') return theme === 'light' ? '#AEB8C4' : '#5a6573'
  // potable-water blues (same family as the 3D tubes): mains darker and wider, services lighter
  const c = theme === 'light' ? FLAT_LIGHT : FLAT_DARK
  return p.trunk || p.dn >= 400 ? c.main : p.dn >= 150 ? c.dist : c.service
}
const FLAT_LIGHT = { main: '#1F4E8C', dist: '#2F6DB5', service: '#5B93CF' }
const FLAT_DARK = { main: '#4C8DDB', dist: '#6FA6E6', service: '#9CC3EE' }

/* ── 3D tube colours ──
   Close up the pipes are objects, not map lines, so they get the palette used for utility models:
   potable water in the blue family (APWA / ISO 14726 colour for drinking water), darker and more
   saturated for bigger mains so the hierarchy reads at a glance, graphite flanges, and red / ghost
   grey reserved for leaks and pipes not in service. Thematic paint modes keep their meaning but
   with muted, coated-material tones instead of flat-map hues. */
const TUBE: Record<ThemeName, { main: string; dist: string; service: string; leak: string; planned: string; abandoned: string; fitting: string }> = {
  light: { main: '#25579A', dist: '#3A78C2', service: '#6EA2D8', leak: '#C0392B', planned: '#9AAABB', abandoned: '#7B848E', fitting: '#2E3742' },
  dark: { main: '#2F64AD', dist: '#4F8FD6', service: '#86B6E6', leak: '#E0533F', planned: '#7F90A3', abandoned: '#5E6772', fitting: '#3A4450' },
}
/** Pipe materials as they look: coated ductile iron, black PE, grey PVC, steel, rusted cast iron. */
const TUBE_MATERIAL: Record<string, string> = {
  'Gang dẻo': '#3F5F82',
  HDPE: '#2E3640',
  uPVC: '#9FB0C0',
  Thép: '#7A858F',
  'Gang xám': '#8A5A3E',
}
/** Muted ramp (good → poor / small → large) for the thematic modes. */
const TUBE_RAMP = ['#2F7D5B', '#5E9A4A', '#B08A2E', '#C2632D', '#B03A30'] as const
const TUBE_DN_RAMP = ['#8FB4D9', '#5F93C9', '#3A78C2', '#2A5EA3', '#1E3F78'] as const

export const tubeFittingColor = (theme: ThemeName) => TUBE[theme === 'light' ? 'light' : 'dark'].fitting

/** Colour of a pipe's 3D tube (see TUBE). */
export function pipeTubeColor(
  p: Pick<Pipe, 'status' | 'material' | 'cond' | 'dma' | 'dn' | 'year' | 'trunk'>,
  theme: ThemeName,
  paint: { mode?: string } | undefined,
  G: GisData
): string {
  const c = TUBE[theme === 'light' ? 'light' : 'dark']
  const mode = paint && paint.mode
  if (p.status === 'abandoned') return c.abandoned
  if (mode && mode !== 'status') {
    if (mode === 'material') return TUBE_MATERIAL[p.material] || c.abandoned
    if (mode === 'dn') {
      const d = p.dn
      return TUBE_DN_RAMP[d >= 500 ? 4 : d >= 300 ? 3 : d >= 200 ? 2 : d >= 150 ? 1 : 0]
    }
    if (mode === 'age') {
      if (!p.year) return c.abandoned
      const a = 2026 - p.year
      return TUBE_RAMP[a > 30 ? 4 : a > 18 ? 3 : a > 8 ? 2 : 0]
    }
    // condition / DMA: the category colour, toned down to a coated finish
    return muted(pipeColor(p, 'light', paint, G))
  }
  if (p.status === 'leak') return c.leak
  if (p.status === 'planned') return c.planned
  return p.trunk || p.dn >= 400 ? c.main : p.dn >= 150 ? c.dist : c.service
}

/** Pull a hue towards slate grey and darken it a little (flat-map colours look like toys on a 3D solid). */
function muted(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const grey = [92, 104, 118]
  const out = rgb.map((v, i) => Math.round((v * 0.7 + grey[i]! * 0.3) * 0.88))
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('')
}

export const pipeWidth = (dn: number) => (dn >= 500 ? 6.5 : dn >= 400 ? 5.5 : dn >= 300 ? 4.4 : dn >= 200 ? 3.3 : dn >= 150 ? 2.6 : 2)

/** Casing under every pipe (cased lines read as one network and stay legible on imagery). */
export const pipeCasing = (theme: ThemeName, imagery: boolean) =>
  imagery || theme !== 'light' ? 'rgba(6, 11, 17, 0.88)' : 'rgba(18, 30, 44, 0.42)'
export const CASING_EXTRA_PX = 2.2

/** Size (px) of an in-line symbol (valve, meter, reducer…) on a pipe of this DN: about 5.4× the line width. */
export const inlineSymbolSize = (dn: number | undefined) => Math.round(Math.min(30, Math.max(17, pipeWidth(dn || 100) * 5.4)))
/** Size (px) of a point badge (sensor, hydrant, facility). */
export const BADGE_PX = 19

/** 3D tube for a pipe of the given DN. A selected pipe is drawn thicker (the flat halo sits
 * under the tube in 3D, so the tube itself has to carry the highlight). */
export const pipeTube = (dn: number, color: string, selected = false, fittingColor = TUBE.light.fitting): NonNullable<FeatureStyle3D['tube']> => ({
  diameterM: (Math.max(dn, 25) / 1000) * PIPE_3D_SCALE * (selected ? SELECTED_3D_SCALE : 1),
  color,
  fittingColor,
})

/** Map highlight for the selected / emphasised asset. Deliberately NOT the UI accent: the accent
 * (#0E7C86) is the trunk-main colour, so a selected main looked unselected. */
export const SELECTION_COLOR = '#FFC400'

/** Size boost for a selected 3D tube / solid. */
export const SELECTED_3D_SCALE = 1.4

/** Water speed (m/s, relative) from operating pressure: higher pressure → faster animation. */
export function flowSpeedFromPressure(bar: number | undefined): number {
  const p = Math.min(Math.max(bar ?? 3, 0.5), 8)
  return 0.15 + 0.5 * p
}

/** Dark outline under pipes so they stay readable on aerial imagery. */
export const IMAGERY_CASING = 'rgba(8, 14, 22, 0.6)'
export const isImageryBasemap = (id: string) => id === 'satellite'

/**
 * Flow animation for one pipe. With an EPANET result (`hydro`), direction and speed come from the
 * solve and a pipe without flow stays still; otherwise the pressure estimate on the pipe is used.
 */
export function pipeFlow(
  pipe: Pick<Pipe, 'id' | 'status' | 'noFlow' | 'pressure' | 'flowDir'>,
  hydro: Map<string, PipeFlow> | null
): FeatureStyle3D['flow'] | undefined {
  // only live pipes carry water; planned / abandoned ones stay still
  if (pipe.noFlow || !(pipe.status === 'active' || pipe.status === 'ok' || pipe.status === undefined)) return undefined
  if (hydro) {
    const r = hydro.get(pipe.id)
    return r ? { speedMps: flowSpeedFromVelocity(r.velocity), direction: r.flowDir === 'reverse' ? -1 : 1 } : undefined
  }
  return { speedMps: flowSpeedFromPressure(pipe.pressure), direction: pipe.flowDir === 'reverse' ? -1 : 1 }
}
