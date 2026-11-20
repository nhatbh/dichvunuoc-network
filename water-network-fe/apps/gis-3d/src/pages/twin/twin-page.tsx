/**
 * "Bản đồ số 3D" — integrated 3D map of the Vĩnh Thịnh network and the Sông Hồng plant (frontend-only demo,
 * mock real-time data). Map ↔ plant: clicking the plant on the map flies into it and opens the plant's own
 * 3D view; both share one simulation, so what the operator does in the plant shows on the network.
 */
import { Moon, Sun } from 'lucide-solid'
import { createSignal, onMount, Show } from 'solid-js'
import './twin.css'
import { FactoryScreen } from './ui/factory-screen'
import { ScadaWindow, type HmiTarget } from './ui/hmi/scada'
import { MapScreen } from './ui/map-screen'
import { SimProvider } from './ui/sim-context'

export function TwinPage() {
  const [mode, setMode] = createSignal<'map' | 'factory'>('map')
  const [site, setSite] = createSignal<'plant' | 'tb1'>('plant')
  const [ret, setRet] = createSignal(0)
  const [theme, setTheme] = createSignal<'light' | 'dark'>('light')
  const [hmi, setHmi] = createSignal<HmiTarget | null>(null)
  onMount(() => {
    const t = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null) ?? 'light'
    setTheme(t === 'dark' ? 'dark' : 'light')
    document.title = 'Bản đồ số 3D · Mạng lưới cấp nước'
  })
  const flipTheme = () => {
    const t = theme() === 'light' ? 'dark' : 'light'
    setTheme(t)
    document.documentElement.setAttribute('data-theme', t)
  }
  return (
    <SimProvider>
      <div class="tw-root" data-testid="twin">
        <MapScreen
          active={mode() === 'map'}
          returnTick={ret()}
          onEnter={s => {
            setSite(s)
            setMode('factory')
          }}
        />
        <Show when={mode() === 'map'}>
          <header class="tw-top tw-glass">
            <a class="tw-brand" href="/gis" title="Về ứng dụng GIS" style={{ color: 'inherit', 'text-decoration': 'none' }}>
              <img src="/system-logo.png" alt="" />
              <div>
                <h1>Bản đồ số 3D · Vĩnh Thịnh – Sông Hồng</h1>
                <small>Mạng lưới đợt 3 + ống dịch vụ + nhà máy 29.000 m³/ngđ, dựng từ bản vẽ CAD · dữ liệu mô phỏng thời gian thực</small>
              </div>
            </a>
            <div class="tw-spacer" />
            <button type="button" class="tw-btn primary" onClick={() => setHmi({ mode: 'scada', screen: 'overview' })} title="Màn hình SCADA trung tâm">
              SCADA
            </button>
            <a class="tw-btn" href="/gis">
              Ứng dụng GIS
            </a>
            <button type="button" class="tw-btn icon" onClick={flipTheme} title="Đổi giao diện" aria-label="Đổi giao diện">
              {theme() === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </header>
        </Show>
        <Show when={mode() === 'factory'}>
          <FactoryScreen
            onOpenHmi={setHmi}
            site={site()}
            onBack={() => {
              setMode('map')
              setRet(x => x + 1)
            }}
          />
        </Show>
      </div>
      <Show when={hmi()}>{t => <ScadaWindow target={t()} onClose={() => setHmi(null)} />}</Show>
    </SimProvider>
  )
}
