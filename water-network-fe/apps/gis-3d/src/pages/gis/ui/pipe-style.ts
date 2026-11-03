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
  if (p.status === 'planned') return t('#0969DA')
  if (p.status === 'abandoned') return theme === 'light' ? '#AEB8C4' : '#5a6573'
  return p.trunk ? t('#0E7C86') : theme === 'light' ? '#3FA0A8' : '#7fd0db'
}

export const pipeWidth = (dn: number) => (dn >= 500 ? 6 : dn >= 300 ? 4.6 : dn >= 200 ? 3 : 2.2)

/** 3D tube for a pipe of the given DN. A selected pipe is drawn thicker (the flat halo sits
 * under the tube in 3D, so the tube itself has to carry the highlight). */
export const pipeTube = (dn: number, color: string, selected = false): NonNullable<FeatureStyle3D['tube']> => ({
  diameterM: (Math.max(dn, 25) / 1000) * PIPE_3D_SCALE * (selected ? SELECTED_3D_SCALE : 1),
  color,
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
