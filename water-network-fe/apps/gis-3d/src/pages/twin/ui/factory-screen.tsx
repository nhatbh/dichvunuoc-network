/**
 * The plant's 3D view with its overlay: process strip (top), area / equipment explorers in rail flyouts (left),
 * live charts (right, foldable to chips), faceplate or area card in a drawer, view toggles (bottom right).
 */
import { ArrowLeft, CircleHelp, Hand, House, LayoutGrid, MonitorCog, Scan, Tag, Waves, Wrench } from 'lucide-solid'
import { createEffect, createSignal, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js'
import { basemap, RASTERS } from './basemap'
import { Faceplate } from './faceplate'
import { CloudVeil, DESCENT_MS } from './intro'
import { AreaList, EquipList, UnitCard } from './plant-explorer'
import { ProcessStrip } from './process-strip'
import { director, TourButton } from './tour'
import { AlarmBell, AlarmPanel, ChartStack, Drawer, Flyout, HintBar, isNarrow, persisted, Rail, SimControl, ThemeButton, TopBar, type ChartDef } from './shell'
import { useSim } from './sim-context'
import { EQUIPMENT, EQUIPMENT_BY_TAG, PLANT } from '../data/plant-model'
import { FactoryView } from '../factory/factory-view'
import type { HmiTarget } from './hmi/scada'

type Fly = 'areas' | 'equip' | 'alarms' | null

/**
 * The plant's 3D view. It is built once, in the background while the page opens (`onReady` when it has drawn), and
 * kept: showing it (`active`) only starts its descent out of the cloud, so going in from the map never stalls.
 */
export function FactoryScreen(props: {
  active: boolean
  site: 'plant' | 'tb1'
  onReady: () => void
  onBack: () => void
  onOpenHmi: (t: HmiTarget) => void
}) {
  const { sim } = useSim()
  let el!: HTMLDivElement
  let view: FactoryView | null = null
  const [tag, setTag] = createSignal<string | null>(null)
  const [unit, setUnit] = createSignal<string | null>(null)
  const [fly, setFly] = persisted<Fly>('fly.factory', null)
  const [roofs, setRoofs] = persisted('factory.roofs', true)
  const [labels, setLabels] = persisted('factory.labels', true)
  const [flow, setFlow] = persisted('factory.flow', true)
  const [hints, setHints] = persisted('hints.factory.v2', false)

  /** the 3D view opens out of the cloud the map closed into, panels sliding in */
  const [veil, setVeil] = createSignal<'clear' | null>(null)
  const [entering, setEntering] = createSignal(false)
  let enterTimer = 0
  createEffect(
    on(
      () => props.active,
      a => {
        if (view) view.active = a
        if (!a || !view) return
        if (props.site === 'tb1') setUnit('TB1')
        // out of the white the map faded to, the camera descending as the white clears
        view.intro(props.site, DESCENT_MS / 1000)
        setVeil(null)
        queueMicrotask(() => setVeil('clear'))
        setEntering(true)
        window.clearTimeout(enterTimer)
        enterTimer = window.setTimeout(() => setEntering(false), DESCENT_MS + 1200)
      },
      { defer: true },
    ),
  )
  onMount(() => {
    view = new FactoryView(el, sim)
    if (import.meta.env.DEV) Object.assign((window as unknown as { __twin: object }).__twin ?? {}, { factory: view })
    view.setRoofs(roofs())
    view.setLabels(labels())
    view.showFlow = flow()
    view.onPick = (t, u) => {
      setTag(t)
      setUnit(u)
      if (u && isNarrow()) setFly(null)
    }
    director.factory = {
      lock: on => view?.setTourMode(on),
      overview: site => view?.focusSite(site),
      pickUnit,
      pickTag,
      closeDrawer,
      setFly,
    }
    // built in the background: it draws its warm-up frames out of sight, then waits until it is shown
    view.active = props.active
    view.intro(props.site, DESCENT_MS / 1000)
    requestAnimationFrame(() => requestAnimationFrame(() => props.onReady()))
  })
  onCleanup(() => view?.dispose())
  // the ground is the same basemap as the network map's
  createEffect(on(basemap, b => view?.setBasemap(RASTERS[b])))
  createEffect(on(roofs, r => view?.setRoofs(r), { defer: true }))
  createEffect(on(labels, l => view?.setLabels(l), { defer: true }))
  createEffect(
    on(
      flow,
      f => {
        if (view) view.showFlow = f
      },
      { defer: true },
    ),
  )
  // the focused building opens up (its roof is cut away) so its equipment stays visible
  createEffect(() => view?.setCutaway(unit()))

  const pickTag = (t: string) => {
    const e = EQUIPMENT_BY_TAG[t]
    setTag(t)
    setUnit(e?.unit ?? null)
    view?.select(t)
    view?.focusTag(t)
    if (isNarrow()) setFly(null)
  }
  const pickUnit = (u: string) => {
    setUnit(u)
    setTag(null)
    view?.select(null)
    view?.focusUnit(u)
    if (isNarrow()) setFly(null)
  }
  const closeDrawer = () => {
    setTag(null)
    setUnit(null)
    view?.select(null)
  }
  const openScreen = (screen: HmiTarget['screen'], local = false, station?: string) => props.onOpenHmi({ mode: local ? 'local' : 'scada', screen, station })

  const H = sim.history
  const charts: ChartDef[] = [
    { id: 'pOut', label: 'Áp lực ra mạng', unit: 'bar', digits: 2, value: () => sim.pOut, data: () => H.pOut, color: '#2f86d6', band: [3.6, 4.8], level: () => (sim.pOut < 2.5 ? 'crit' : sim.pOut < 3.6 ? 'warn' : null), onFocus: () => pickUnit('S07'), focusLabel: 'Xem trạm bơm nước sạch' },
    { id: 'qOut', label: 'Lưu lượng phát', unit: 'm³/h', digits: 0, value: () => sim.qOut, data: () => H.qOut, color: '#1d6cae', min: 0, note: () => `nhu cầu ${Math.round(sim.qDemand)}`, onFocus: () => pickUnit('S07'), focusLabel: 'Xem trạm bơm nước sạch' },
    { id: 'res', label: 'Mực nước bể chứa', unit: '%', digits: 0, value: () => sim.reservoirPct, data: () => H.res, color: '#2fa36b', band: [30, 95], min: 0, max: 100, level: () => (sim.reservoirPct < 8 ? 'crit' : sim.reservoirPct < 20 ? 'warn' : null), onFocus: () => pickUnit('S06'), focusLabel: 'Xem bể chứa' },
    { id: 'turb', label: 'Độ đục sau lọc', unit: 'NTU', digits: 2, value: () => sim.filteredTurb, data: () => H.turb, color: '#d9822b', band: [0, 1], min: 0, level: () => (sim.filteredTurb > 2 ? 'crit' : sim.filteredTurb > 1 ? 'warn' : null), onFocus: () => pickUnit('S05'), focusLabel: 'Xem cụm bể lọc' },
    { id: 'cl', label: 'Clo dư', unit: 'mg/L', digits: 2, value: () => sim.clRes, data: () => H.cl, color: '#6aa82e', band: [0.3, 1.0], min: 0, level: () => (sim.clRes < 0.2 ? 'crit' : sim.clRes < 0.3 ? 'warn' : null), onFocus: () => pickUnit('S09'), focusLabel: 'Xem nhà clo' },
    { id: 'raw', label: 'Độ đục nước thô', unit: 'NTU', digits: 0, value: () => sim.rawTurb, data: () => H.raw, color: '#9c7a4a', min: 0, level: () => (sim.rawTurb > 400 ? 'crit' : sim.rawTurb > 180 ? 'warn' : null), onFocus: () => pickUnit('TB1'), focusLabel: 'Xem trạm bơm TB1' },
  ]

  const drawerOpen = () => !!(tag() || unit())
  return (
    <div class="tw-stage tw-screen factory" classList={{ 'tw-hidden': !props.active, 'tw-enter': entering() }} data-fly={fly() ?? undefined} data-drawer={drawerOpen() ? '' : undefined}>
      <div ref={el} class="tw-stage" />

      <TopBar crumbs={[{ label: 'Bản đồ số 3D', icon: ArrowLeft, onClick: props.onBack, title: 'Về bản đồ mạng lưới' }, { label: PLANT.name }]}>
        <SimControl
          scenarios={[
            { label: 'Rò rỉ clo', hint: 'Đầu dò khí GD-901 báo rò, quạt khử độc tự chạy', run: () => sim.injectLeak() },
            { label: 'Lũ, nước thô đục cao', hint: 'Độ đục sông tăng mạnh trong 6 giờ, PAC tăng theo', run: () => sim.injectFlood() },
            { label: 'Sự cố bơm P-NS-01', hint: 'Bơm nước sạch số 1 dừng, bơm dự phòng tự chạy', run: () => sim.command('P-NS-01', 'fault') },
          ]}
        />
        <AlarmBell pressed={fly() === 'alarms'} onClick={() => setFly(f => (f === 'alarms' ? null : 'alarms'))} />
        <button type="button" class="tw-btn primary" onClick={() => openScreen('overview')}>
          <MonitorCog size={16} />
          <span class="tw-hide-narrow">SCADA</span>
        </button>
        <TourButton />
        <ThemeButton />
      </TopBar>

      <ProcessStrip unit={unit()} onPick={pickUnit} onNetwork={props.onBack} />

      <Rail
        active={fly()}
        onSelect={id => setFly(id as Fly)}
        items={[
          { id: 'areas', label: 'Khu vực', icon: LayoutGrid },
          { id: 'equip', label: 'Thiết bị', icon: Wrench },
        ]}
        foot={[{ id: 'help', label: 'Hướng dẫn', icon: CircleHelp, pressed: hints, onClick: () => setHints(x => !x) }]}
      />
      <Switch>
        <Match when={fly() === 'areas'}>
          <Flyout title="Khu vực" onClose={() => setFly(null)}>
            <AreaList unit={unit()} onPick={pickUnit} />
          </Flyout>
        </Match>
        <Match when={fly() === 'equip'}>
          <Flyout title="Thiết bị" sub={`${EQUIPMENT.length} thiết bị`} onClose={() => setFly(null)}>
            <EquipList tag={tag()} onPick={pickTag} />
          </Flyout>
        </Match>
        <Match when={fly() === 'alarms'}>
          <Flyout title="Báo động" onClose={() => setFly(null)}>
            <AlarmPanel onTag={pickTag} />
          </Flyout>
        </Match>
      </Switch>

      <ChartStack store="factory" title="Theo dõi nhà máy" charts={charts} compact={drawerOpen()} defaultClosed={['raw']} />

      <Show when={drawerOpen()}>
        <Drawer label="Thông tin và điều khiển" onClose={() => (tag() ? (setTag(null), view?.select(null)) : closeDrawer())}>
          <Switch>
            <Match when={tag()}>
              {t => (
                <Faceplate
                  tag={t()}
                  onClose={() => {
                    setTag(null)
                    view?.select(null)
                  }}
                  onOpenScreen={(screen, local, tg) => openScreen(screen, local, local ? tg : undefined)}
                />
              )}
            </Match>
            <Match when={unit()}>{u => <UnitCard id={u()} tag={tag()} onPick={pickTag} onClose={closeDrawer} onOpenScreen={s => openScreen(s)} />}</Match>
          </Switch>
        </Drawer>
      </Show>

      <div class="tw-tools tw-glass" role="toolbar" aria-label="Hiển thị cảnh 3D">
        <button type="button" class="tw-tk" onClick={() => view?.focusSite('plant')} title="Nhìn toàn cảnh nhà máy">
          <Scan size={17} />
          <span>Toàn cảnh</span>
        </button>
        <button type="button" class="tw-tk" aria-pressed={roofs()} onClick={() => setRoofs(x => !x)} title={roofs() ? 'Ẩn mái các nhà' : 'Hiện mái các nhà'}>
          <House size={17} />
          <span>Mái</span>
        </button>
        <button type="button" class="tw-tk" aria-pressed={labels()} onClick={() => setLabels(x => !x)} title={labels() ? 'Ẩn nhãn' : 'Hiện nhãn'}>
          <Tag size={17} />
          <span>Nhãn</span>
        </button>
        <button type="button" class="tw-tk" aria-pressed={flow()} onClick={() => setFlow(x => !x)} title={flow() ? 'Ẩn dòng chảy trong ống' : 'Hiện dòng chảy trong ống'}>
          <Waves size={17} />
          <span>Dòng chảy</span>
        </button>
      </div>

      <small class="tw-attrib">{RASTERS[basemap()].attribution}</small>
      <Show when={props.active && veil()} keyed>
        {m => <CloudVeil mode={m} onDone={() => setVeil(null)} />}
      </Show>

      <Show when={hints()}>
        <HintBar
          onHide={() => setHints(false)}
          hints={[
            { icon: Hand, text: 'Kéo để xoay, chuột phải để dời' },
          ]}
        />
      </Show>
    </div>
  )
}
