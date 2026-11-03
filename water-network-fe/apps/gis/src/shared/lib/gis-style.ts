export interface StyleSpec {
  stroke?: { color: string; width: number; dash?: number[] }
  fill?: { color: string }
  image?: { shape: 'circle' | 'square'; radius: number; color: string }
}
interface Props { assetType: string; status?: string; trunk?: boolean; dn?: number; col?: string }
export function styleSpecFor(props: Props): StyleSpec {
  const a = props.assetType
  if (a === 'pipe') {
    const w = (props.dn ?? 100) >= 300 ? 4.5 : (props.dn ?? 100) >= 200 ? 3 : 2.2
    if (props.status === 'leak') return { stroke: { color: '#D1242F', width: w } }
    if (props.status === 'planned') return { stroke: { color: '#0969DA', width: w, dash: [8, 5] } }
    if (props.status === 'abandoned') return { stroke: { color: '#AEB8C4', width: w, dash: [3, 6] } }
    return { stroke: { color: props.trunk ? '#0E7C86' : '#3FA0A8', width: props.trunk ? Math.max(4, w) : w } }
  }
  if (a === 'valve') return { image: { shape: 'square', radius: 4.5, color: '#0969DA' } }
  if (a === 'hydrant') return { image: { shape: 'circle', radius: 3.5, color: '#D1242F' } }
  if (a === 'node') return { image: { shape: 'circle', radius: 2.6, color: '#8250DF' } }
  if (a === 'dma') return { stroke: { color: props.col ?? '#9A6700', width: 1.4, dash: [7, 5] }, fill: { color: 'rgba(154,103,0,0.06)' } }
  return { image: { shape: 'square', radius: 5, color: '#1A7F37' } }
}
