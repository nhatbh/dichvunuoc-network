/* HUD — the network's key figures as glass cards floating top-left over the map
   (prototype: "Chỉ số vận hành"). Each card opens the panel that explains it. */
import { For, Show, createSignal, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { IcAlert, IcChevD } from '../lib/icons'
import { fmtDec, fmtInt, tone } from '../lib/theme'
import type { Route } from './nav'

const MAT_COLS = ['#0E7C86', '#0969DA', '#8250DF', '#D86C1F', '#1A7F37']

function readMin(): boolean {
  try {
    return localStorage.getItem('sx-hud-min') === '1'
  } catch {
    return false
  }
}

export function NetworkHud(props: { go: (r: Route) => void }): JSX.Element {
  const G = useGis()
  const D = G.DASH
  const [min, setMin] = createSignal(readMin())
  const toggle = () => {
    const next = !min()
    setMin(next)
    try {
      localStorage.setItem('sx-hud-min', next ? '1' : '0')
    } catch {
      /* storage unavailable: keep in memory only */
    }
  }
  const matTotal = D.matMix.reduce((s, m) => s + m.n, 0) || 1
  const condTotal = D.condMix.reduce((s, c) => s + c.n, 0) || 1
  const queue = [
    { label: 'Change set chờ duyệt', n: D.csPending, to: 'versions', col: '#8250DF' },
    { label: 'Job import đang xử lý', n: D.importPending, to: 'import', col: '#0E7C86' },
    { label: 'Hiện trường chờ đồng bộ', n: D.fieldPending, to: 'field', col: '#D86C1F' },
  ]
  return (
    <section class="sx-hud" data-min={min() ? 'true' : 'false'} aria-label="Chỉ số mạng lưới">
      <button
        type="button"
        class="sx-hud-toggle sx-glass"
        aria-expanded={!min()}
        onClick={toggle}
        title={min() ? 'Hiện chỉ số mạng lưới' : 'Thu gọn chỉ số'}
      >
        <span class="sx-live" style={{ background: 'var(--good)' }} aria-hidden="true" />
        Chỉ số mạng lưới
        <IcChevD size={15} />
      </button>
      <div class="sx-hud-grid">
        <button
          type="button"
          class="sx-hud-card sx-glass"
          onClick={() => props.go({ name: 'assets' })}
        >
          <span class="sx-hc-top">
            <span class="sx-hc-lbl">Tuyến ống</span>
          </span>
          <span class="sx-hc-main">
            <span>
              <span class="sx-hc-val">{fmtDec(D.pipeKm, 1)}</span>
              <span class="sx-hc-u">km</span>
            </span>
          </span>
          <span class="sx-bar" aria-hidden="true">
            <For each={D.matMix}>
              {(m, i) => (
                <i
                  style={{
                    width: `${(m.n / matTotal) * 100}%`,
                    background: tone(MAT_COLS[i() % 5]!),
                  }}
                />
              )}
            </For>
          </span>
          <span class="sx-hc-sub">
            {fmtInt(D.pipeCount)} tuyến · {G.MATERIALS.length} vật liệu
          </span>
        </button>

        <button
          type="button"
          class="sx-hud-card sx-glass"
          onClick={() => props.go({ name: 'assets' })}
        >
          <span class="sx-hc-top">
            <span class="sx-hc-lbl">Tài sản điểm</span>
          </span>
          <span class="sx-hc-main">
            <span class="sx-hc-val">{fmtInt(D.valveCount + D.hydrantCount)}</span>
          </span>
          <span class="sx-hc-sub">
            {fmtInt(D.valveCount)} van · {fmtInt(D.hydrantCount)} trụ PCC
          </span>
        </button>

        <button
          type="button"
          class="sx-hud-card sx-glass"
          onClick={() => props.go({ name: 'connections' })}
        >
          <span class="sx-hc-top">
            <span class="sx-hc-lbl">Đấu nối KH</span>
            <span class="sx-hc-tag">{D.dmaCount} DMA</span>
          </span>
          <span class="sx-hc-main">
            <span class="sx-hc-val">{fmtInt(D.connCount)}</span>
          </span>
          <span class="sx-bar" aria-hidden="true">
            <i style={{ width: `${D.geocodedPct}%`, background: 'var(--accent)' }} />
          </span>
          <span class="sx-hc-sub">{D.geocodedPct}% đã geocode</span>
        </button>

        <button
          type="button"
          class="sx-hud-card sx-glass"
          classList={{ crit: D.topoOpen > 0 }}
          onClick={() => props.go({ name: 'topology' })}
        >
          <span class="sx-hc-top">
            <span class="sx-hc-lbl">Lỗi topology</span>
            <Show when={D.topoOpen > 0}>
              <span style={{ color: 'var(--critical-ink)' }}>
                <IcAlert size={14} />
              </span>
            </Show>
          </span>
          <span class="sx-hc-main">
            <span class="sx-hc-val">{fmtInt(D.topoOpen)}</span>
          </span>
          <span class="sx-hc-sub">
            {D.topoOpen > 0 ? 'cần xử lý trước khi đồng bộ' : 'sạch topology'}
          </span>
        </button>

        <button
          type="button"
          class="sx-hud-card sx-glass wide"
          onClick={() => props.go({ name: 'assets' })}
        >
          <span class="sx-hc-top">
            <span class="sx-hc-lbl">Tình trạng tuyến ống</span>
            <span class="sx-hc-tag">{fmtInt(condTotal)} tuyến</span>
          </span>
          <span class="sx-bar" aria-hidden="true">
            <For each={D.condMix}>
              {c => <i style={{ width: `${(c.n / condTotal) * 100}%`, background: tone(c.col) }} />}
            </For>
          </span>
          <span class="grid grid-cols-2 gap-x-4">
            <For each={D.condMix}>
              {c => (
                <span class="sx-qrow">
                  <span class="sx-qd" style={{ background: tone(c.col) }} />
                  <span>{c.label}</span>
                  <b>{fmtInt(c.n)}</b>
                </span>
              )}
            </For>
          </span>
        </button>

        <div class="sx-hud-card sx-glass wide" style={{ cursor: 'default' }}>
          <span class="sx-hc-top">
            <span class="sx-hc-lbl">Hàng đợi xử lý</span>
            <span class="sx-hc-tag">cập nhật {G.TODAY}</span>
          </span>
          <span class="grid gap-0.5 pt-0.5">
            <For each={queue}>
              {q => (
                <button
                  type="button"
                  class="sx-qrow -mx-1 rounded-md px-1 text-left hover:bg-[var(--hover)]"
                  onClick={() => props.go({ name: q.to })}
                >
                  <span class="sx-qd" style={{ background: q.n > 0 ? tone(q.col) : undefined }} />
                  <span>{q.label}</span>
                  <b>{fmtInt(q.n)}</b>
                </button>
              )}
            </For>
          </span>
        </div>
      </div>
    </section>
  )
}

/** Top-centre banner while topology errors are open (hidden when the topology panel is). */
export function TopologyBanner(props: { route: Route; go: (r: Route) => void }): JSX.Element {
  const G = useGis()
  const [hidden, setHidden] = createSignal(false)
  const n = () => G.DASH.topoOpen
  return (
    <Show when={n() > 0 && !hidden() && props.route.name === 'map'}>
      <div class="sx-banner warn" role="status" data-testid="topology-banner">
        <IcAlert size={17} />
        <button
          type="button"
          class="min-w-0 flex-1 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
          onClick={() => props.go({ name: 'topology' })}
        >
          {fmtInt(n())} lỗi topology đang mở — cần xử lý trước khi đồng bộ sang Hydraulic &amp; DMA
        </button>
        <button type="button" class="sx-bn-more" onClick={() => props.go({ name: 'topology' })}>
          Chi tiết
        </button>
        <button
          type="button"
          class="sx-bn-more"
          aria-label="Ẩn thông báo"
          onClick={() => setHidden(true)}
        >
          ✕
        </button>
      </div>
    </Show>
  )
}
