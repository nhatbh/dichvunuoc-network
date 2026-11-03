import { createEffect, createSignal, onCleanup, type JSX } from 'solid-js'
import type { Camera3D, Map3DPort } from '@wn/map-runtime-3d'
import { Building2, ChevronsDown, ChevronsUp, Droplets, Mountain, Navigation2, RotateCcw, RotateCw } from 'lucide-solid'

const TILT_STEP = 10
const ROTATE_STEP = 30
const MAX_PITCH = 75

/** Square map button in the same style as the zoom / basemap cluster (GIS theme variables). */
function ControlButton(props: {
  label: string
  title: string
  pressed?: boolean
  onClick: () => void
  testId: string
  children?: JSX.Element
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.pressed}
      data-testid={props.testId}
      onClick={() => props.onClick()}
      class="flex h-8 w-8 items-center justify-center text-[11px] font-semibold transition-colors [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[color:var(--line)]"
      style={
        props.pressed
          ? { background: 'color-mix(in srgb, var(--focus) 16%, var(--surface))', color: 'var(--focus)' }
          : { color: 'var(--muted)' }
      }
      onMouseEnter={e => !props.pressed && (e.currentTarget.style.background = 'var(--surface2)')}
      onMouseLeave={e => !props.pressed && (e.currentTarget.style.background = '')}
    >
      {props.children ?? props.label}
    </button>
  )
}

/** A bordered column of buttons, like the zoom cluster. */
function Group(props: { label: string; children: JSX.Element }) {
  return (
    <div
      role="group"
      aria-label={props.label}
      class="flex flex-col overflow-hidden rounded-lg border border-[color:var(--line)] bg-[var(--surface)]"
      style={{ 'box-shadow': 'var(--card-shadow)' }}
    >
      {props.children}
    </div>
  )
}

/**
 * 3D camera controls: 2D/3D toggle, tilt, rotate, compass (reset north),
 * extruded buildings and terrain. Talks only to the {@link Map3DPort}.
 */
export function Map3DControls(props: { port: () => Map3DPort | null }) {
  const [camera, setCamera] = createSignal<Camera3D>({ pitch: 0, bearing: 0 })
  const [buildings, setBuildings] = createSignal(false)
  const [terrain, setTerrain] = createSignal(false)
  const [flow, setFlow] = createSignal(true)

  createEffect(() => {
    const p = props.port()
    if (!p) return
    setCamera(p.getCamera())
    setBuildings(p.getBuildings())
    setTerrain(p.getTerrain().enabled)
    setFlow(p.getFlowAnimation())
    const off = p.onCameraChange(c => setCamera({ pitch: c.pitch, bearing: c.bearing }))
    onCleanup(off)
  })

  const is3D = () => camera().pitch > 0.5
  const tilt = (delta: number) => {
    const next = Math.min(MAX_PITCH, Math.max(0, camera().pitch + delta))
    props.port()?.setCamera({ pitch: next })
  }
  const rotate = (delta: number) => props.port()?.setCamera({ bearing: camera().bearing + delta })
  const toggleBuildings = () => {
    const next = !buildings()
    props.port()?.setBuildings(next)
    setBuildings(next)
  }
  const toggleFlow = () => {
    const next = !flow()
    props.port()?.setFlowAnimation(next)
    setFlow(next)
  }
  const toggleTerrain = () => {
    const next = !terrain()
    props.port()?.setTerrain({ enabled: next, exaggeration: 1.5 })
    setTerrain(next)
  }

  return (
    <div
      data-testid="map-3d-controls"
      class="pointer-events-auto flex flex-col items-end gap-2"
      role="group"
      aria-label="Điều khiển 3D"
    >
      <Group label="Chế độ xem">
        <ControlButton
          label={is3D() ? '3D' : '2D'}
          title={is3D() ? 'Chuyển về 2D' : 'Chuyển sang 3D'}
          pressed={is3D()}
          testId="map-3d-toggle"
          onClick={() => props.port()?.set3DMode(!is3D())}
        />
      </Group>
      <Group label="Góc nhìn">
        <ControlButton label="Nghiêng thêm" title="Nghiêng thêm" testId="map-tilt-up" onClick={() => tilt(TILT_STEP)}>
          <ChevronsUp size={16} />
        </ControlButton>
        <ControlButton label="Nghiêng bớt" title="Nghiêng bớt" testId="map-tilt-down" onClick={() => tilt(-TILT_STEP)}>
          <ChevronsDown size={16} />
        </ControlButton>
        <ControlButton label="Xoay trái" title="Xoay trái" testId="map-rotate-left" onClick={() => rotate(-ROTATE_STEP)}>
          <RotateCcw size={15} />
        </ControlButton>
        <ControlButton label="Xoay phải" title="Xoay phải" testId="map-rotate-right" onClick={() => rotate(ROTATE_STEP)}>
          <RotateCw size={15} />
        </ControlButton>
        <ControlButton label="N" title="Hướng Bắc" testId="map-compass" onClick={() => props.port()?.resetNorth()}>
          <span style={{ transform: `rotate(${-camera().bearing}deg)`, display: 'inline-flex' }}>
            <Navigation2 size={15} />
          </span>
        </ControlButton>
      </Group>
      <Group label="Lớp hiển thị">
        <ControlButton label="Toà nhà 3D" title="Toà nhà 3D" pressed={buildings()} testId="map-buildings-toggle" onClick={toggleBuildings}>
          <Building2 size={15} />
        </ControlButton>
        <ControlButton label="Dòng chảy" title="Dòng chảy" pressed={flow()} testId="map-flow-toggle" onClick={toggleFlow}>
          <Droplets size={15} />
        </ControlButton>
        <ControlButton label="Địa hình" title="Địa hình" pressed={terrain()} testId="map-terrain-toggle" onClick={toggleTerrain}>
          <Mountain size={15} />
        </ControlButton>
      </Group>
    </div>
  )
}
