/**
 * "Bản đồ số 3D" — integrated 3D map of the Vĩnh Thịnh network and the Sông Hồng plant (frontend-only demo,
 * mock real-time data). Map ↔ plant: clicking the plant on the map flies into it and opens the plant's own
 * 3D view; both share one simulation, so what the operator does in the plant shows on the network.
 * Each screen draws its own overlay (top bar, rail, live charts) from `ui/shell.tsx`.
 */
import { createEffect, createSignal, on, onMount, Show } from 'solid-js'
import './twin.css'
import { FactoryScreen } from './ui/factory-screen'
import { ScadaWindow, type HmiTarget } from './ui/hmi/scada'
import { DESCENT_MS, Splash } from './ui/intro'
import { MapScreen } from './ui/map-screen'
import { SimProvider } from './ui/sim-context'
import { startTour, Tour, tourSeen } from './ui/tour'

export function TwinPage() {
  const [mode, setMode] = createSignal<'map' | 'factory'>('map')
  const [site, setSite] = createSignal<'plant' | 'tb1'>('plant')
  const [ret, setRet] = createSignal(0)
  const [hmi, setHmi] = createSignal<HmiTarget | null>(null)
  /** the map has loaded; the splash has left (the map then descends through cloud) */
  const [mapReady, setMapReady] = createSignal(false)
  const [plantReady, setPlantReady] = createSignal(false)
  const [opened, setOpened] = createSignal(false)
  let root: HTMLDivElement | undefined
  onMount(() => {
    document.title = 'Bản đồ số 3D · Mạng lưới cấp nước'
  })
  // a first visit starts the Live Demo once the map has come down out of the cloud
  createEffect(on(opened, o => o && !tourSeen() && window.setTimeout(startTour, DESCENT_MS + 500), { defer: true }))
  const goMap = () => {
    setMode('map')
    setRet(x => x + 1)
  }
  return (
    <SimProvider>
      <div class="tw-root" data-testid="twin" ref={root}>
        <MapScreen
          active={mode() === 'map'}
          reveal={opened()}
          onReady={() => setMapReady(true)}
          returnTick={ret()}
          onOpenHmi={setHmi}
          onEnter={s => {
            setSite(s)
            setMode('factory')
          }}
        />
        {/* built behind the opening screen and kept, so entering the plant from the map is immediate */}
        <Show when={mapReady()}>
          <FactoryScreen
            active={mode() === 'factory'}
            onReady={() => setPlantReady(true)}
            onOpenHmi={setHmi}
            site={site()}
            onBack={goMap}
          />
        </Show>
      </div>
      <Show when={hmi()} keyed>
        {t => <ScadaWindow target={t} onClose={() => setHmi(null)} />}
      </Show>
      <Show when={opened()}>
        <Tour scene={mode()} goMap={goMap} openHmi={setHmi} root={() => root} />
      </Show>
      <Show when={!opened()}>
        <Splash ready={mapReady() && plantReady()} onDone={() => setOpened(true)} />
      </Show>
    </SimProvider>
  )
}
