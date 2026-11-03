/* Reactive EPANET solve: re-runs (debounced) whenever the network input changes and exposes the
   latest result. An empty or failed solve yields null, so callers fall back to the pressure estimate. */
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from 'solid-js'
import { solveHydraulics, type HydraulicInput, type PipeFlow } from '@/shared/lib/hydraulics/epanet-flow'

export function createFlowSolver(
  input: Accessor<HydraulicInput | null>,
  delayMs = 300
): { flows: Accessor<Map<string, PipeFlow> | null>; solving: Accessor<boolean> } {
  const [flows, setFlows] = createSignal<Map<string, PipeFlow> | null>(null)
  const [solving, setSolving] = createSignal(false)
  let run = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const data = input()
    const ticket = ++run
    clearTimeout(timer)
    if (!data) {
      setFlows(null)
      setSolving(false)
      return
    }
    setSolving(true)
    timer = setTimeout(() => {
      solveHydraulics(data)
        .then(r => ticket === run && setFlows(r.size ? r : null))
        .catch(() => ticket === run && setFlows(null))
        .finally(() => ticket === run && setSolving(false))
    }, untrack(flows) === null ? 0 : delayMs)
  })
  onCleanup(() => {
    run++
    clearTimeout(timer)
  })
  return { flows, solving }
}
