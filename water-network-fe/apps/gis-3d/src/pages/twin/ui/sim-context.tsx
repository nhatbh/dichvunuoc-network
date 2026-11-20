import { createContext, createSignal, onCleanup, useContext, type Accessor, type JSX } from 'solid-js'
import { PlantSim } from '../sim/plant-sim'

interface SimCtx {
  sim: PlantSim
  /** bumps ~4×/s while the simulation runs; read it inside a memo/JSX to re-render live values */
  v: Accessor<number>
}
const Ctx = createContext<SimCtx>()

export function SimProvider(props: { children: JSX.Element }) {
  const sim = new PlantSim()
  const [v, setV] = createSignal(0)
  let last = performance.now()
  let pending = false
  const timer = window.setInterval(() => {
    const now = performance.now()
    sim.advance((now - last) / 1000)
    last = now
  }, 100)
  const unsub = sim.subscribe(() => {
    if (pending) return
    pending = true
    window.setTimeout(() => {
      pending = false
      setV(x => x + 1)
    }, 250)
  })
  onCleanup(() => {
    window.clearInterval(timer)
    unsub()
  })
  return <Ctx.Provider value={{ sim, v }}>{props.children}</Ctx.Provider>
}

export function useSim(): SimCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSim outside SimProvider')
  return c
}

export const f1 = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const f2 = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const f0 = (n: number) => Math.round(n).toLocaleString('vi-VN')
