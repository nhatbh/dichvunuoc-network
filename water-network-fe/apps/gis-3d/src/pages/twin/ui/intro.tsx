/**
 * Opening and scene changes of /twin.
 *  - `Splash`: the service's logo (two hands catching a drop of water) draws itself when the page opens, then breathes
 *    gently while the map loads. It always plays its opening in full, and leaves only once that is done AND the map is
 *    ready, fading to white so the map's cloud descent follows on. The screen itself is public/twin-boot.js/.css, drawn
 *    before the app's code loads.
 *  - `CloudVeil`: white sky with drifting clouds. `clear` parts it (a descent through cloud onto the scene); `close`
 *    gathers it (rising back into cloud before the scene changes); `hold` keeps it shut while a scene gets ready.
 * The screens slide their panels in from the sides with the `tw-enter` class (twin.css) while the camera descends.
 */
import { createEffect, createSignal, For, onCleanup } from 'solid-js'

/** how long the logo's opening takes (ms): the splash never leaves before this */
export const SPLASH_MIN_MS = 2600
/** how long a cloud descent takes (ms): camera flights and panel slides are timed to it */
export const DESCENT_MS = 2400
/** how long gathering the clouds takes before a scene change (ms) */
export const CLOSE_MS = 750

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

declare global {
  interface Window {
    /** draws the opening screen (public/twin-boot.js, loaded by index.html before the app) */
    __twinBoot?: () => HTMLElement
    /** when it was drawn (performance.now()) */
    __twinBootAt?: number
  }
}

/**
 * The opening screen. It is the element public/twin-boot.js drew before the app's code loaded (so the logo shows at
 * once, not a white page), or drawn now if /twin was reached from another page. This drives it: the opening runs its
 * SPLASH_MIN_MS from when it was drawn, then the logo breathes until `ready`, then it leaves and `onDone` is called.
 */
export function Splash(props: { ready: boolean; onDone: () => void }) {
  const el = window.__twinBoot?.() ?? null
  const [opened, setOpened] = createSignal(false)
  const [leaving, setLeaving] = createSignal(false)
  const fast = reducedMotion()
  const shown = performance.now() - (window.__twinBootAt ?? performance.now())
  const t = window.setTimeout(() => setOpened(true), Math.max(0, (fast ? 300 : SPLASH_MIN_MS) - shown))
  onCleanup(() => {
    window.clearTimeout(t)
    el?.remove()
  })
  createEffect(() => {
    el?.classList.toggle('idle', opened())
    el?.classList.toggle('leaving', leaving())
    const load = el?.querySelector('.tw-splash-load')
    if (load) load.innerHTML = opened() && !props.ready && !leaving() ? '<span>Đang tải bản đồ</span><i></i><i></i><i></i>' : '<span>&nbsp;</span>'
  })
  createEffect(() => {
    if (!opened() || !props.ready || leaving()) return
    setLeaving(true)
    window.setTimeout(props.onDone, fast ? 50 : 650)
  })
  // the screen lives outside the app's tree (it was there before the app)
  if (!el) queueMicrotask(props.onDone)
  return null
}

/** clouds: [left %, top %, size vmax, drift x, drift y] — they part outwards from the middle as the camera descends */
const CLOUDS: Array<[number, number, number, number, number]> = [
  [20, 25, 52, -55, -40],
  [76, 22, 56, 50, -40],
  [16, 72, 54, -60, 40],
  [82, 74, 52, 55, 45],
  [48, 50, 44, 0, 30],
]

/** white sky and clouds over a scene: `clear` parts them, `close` gathers them; `onDone` after */
export function CloudVeil(props: { mode: 'clear' | 'close' | 'hold'; ms?: number; onDone?: () => void }) {
  // a veil shows one mode for its life (remount it for another): `hold` is the closed sky, waiting
  // eslint-disable-next-line solid/reactivity
  const mode = props.mode
  const ms = reducedMotion() ? 150 : (props.ms ?? (mode === 'clear' ? DESCENT_MS : CLOSE_MS))
  const t = mode === 'hold' ? 0 : window.setTimeout(() => props.onDone?.(), ms)
  onCleanup(() => window.clearTimeout(t))
  return (
    <div class={`tw-veil ${mode}`} style={{ '--veil-ms': `${ms}ms` }} aria-hidden="true">
      <For each={CLOUDS}>
        {([x, y, s, dx, dy], i) => (
          <span
            class="cloud"
            style={{ left: `${x}%`, top: `${y}%`, '--s': `${s}vmax`, '--dx': `${dx}vw`, '--dy': `${dy}vh`, '--d': `${(i() % 4) * 70}ms` }}
          />
        )}
      </For>
    </div>
  )
}
