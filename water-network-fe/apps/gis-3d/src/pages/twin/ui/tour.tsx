/**
 * Live Demo: a guided tour of the network, the plant, their controls and the SCADA.
 *
 * The tour drives the screens through `director` (each screen registers what it can do: fly the camera, select an
 * object, open a panel). While it runs the cameras are locked and moved by the tour, drifting slowly once they arrive;
 * the screens' panels slide out to the sides, and each step brings back only the ones it talks about
 * (`show`, on .tw-root[data-tour]). A card on one side tells what is shown; a bar at the bottom moves between steps.
 * It starts by itself on a first visit, and from the "Demo" button any time.
 */
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js'
import { f0, f1, f2, useSim } from './sim-context'
import { ENTRY_LONLAT } from '../data/network-model'
import { INTAKE, PLANT } from '../data/plant-model'
import type { HmiTarget } from './hmi/scada'
import type { PickInfo } from '../map/twin-layer'
import type { PlantSim } from '../sim/plant-sim'

/** a camera on the network map */
export interface MapCam {
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
}
export interface MapDirector {
  /** fly there, then drift slowly */
  fly: (cam: MapCam) => void
  /** lock the camera (the tour moves it) */
  lock: (on: boolean) => void
  select: (p: PickInfo | null) => void
  setFly: (f: 'overview' | 'layers' | 'catalog' | 'perf' | 'alarms' | null) => void
  setMode: (m: 'pressure' | 'velocity' | 'dn' | 'kind') => void
  /** go into the plant or TB1 (the map's own transition) */
  enter: (site: 'plant' | 'tb1') => void
}
export interface FactoryDirector {
  lock: (on: boolean) => void
  overview: (site: 'plant' | 'tb1') => void
  pickUnit: (id: string) => void
  pickTag: (tag: string) => void
  closeDrawer: () => void
  setFly: (f: 'areas' | 'equip' | 'alarms' | null) => void
}
export const director: { map: MapDirector | null; factory: FactoryDirector | null } = { map: null, factory: null }

/** what a step can do besides moving the camera */
export interface StepCtx {
  map: MapDirector
  factory: FactoryDirector
  sim: PlantSim
  openHmi: (t: HmiTarget | null) => void
}
/** panels a step shows: top bar, rail, flyout, legend, charts, drawer, process strip, 3D tools */
type Part = 'top' | 'rail' | 'fly' | 'legend' | 'charts' | 'drawer' | 'process' | 'tools'
export interface Step {
  chapter: string
  title: string
  body: string[]
  /** live readings shown on the card */
  live?: Array<[string, (sim: PlantSim) => string]>
  /** something to try once the tour is over */
  tip?: string
  scene: 'map' | 'factory'
  site?: 'plant' | 'tb1'
  cam?: MapCam
  show?: Part[]
  /** the card's side: away from the panels the step shows */
  card?: 'left' | 'right'
  /** what the step does; the returned function undoes it when the step is left */
  run?: (c: StepCtx) => void | (() => void)
}

const HOME: MapCam = { center: [105.4936, 21.1928], zoom: 13.4, pitch: 52, bearing: -14 }
const ll = (p: readonly number[]): [number, number] => [p[0]!, p[1]!]

export const STEPS: Step[] = [
  {
    chapter: 'Giới thiệu',
    title: 'Bản đồ số 3D của hệ thống cấp nước',
    body: [
      'Toàn bộ hệ thống trên một bản đồ: nguồn nước sông Hồng, trạm bơm nước thô TB1, nhà máy nước sạch Sông Hồng và mạng lưới phân phối vùng Vĩnh Thịnh.',
      'Số liệu chạy theo thời gian thực từ một mô phỏng thủy lực: những gì vận hành viên làm ở nhà máy hiện ngay ra áp lực và lưu lượng trên mạng lưới.',
      'Phần trình diễn này đi qua các điểm chính. Dùng thanh bên dưới hoặc phím mũi tên để chuyển bước.',
    ],
    scene: 'map',
    cam: HOME,
  },
  {
    chapter: 'Nguồn nước',
    title: 'Trạm bơm nước thô TB1',
    body: [
      'Nước được lấy từ sông Hồng qua mương dẫn và song chắn rác vào giếng thu. Hiệu ứng sóng trong mương chạy theo lưu lượng bơm thực tế: dừng bơm thì nước lặng.',
      'Ba bơm 1.450 m³/h, cột áp 45 m đẩy nước thô theo ống thép D600 dài khoảng 5 km về nhà máy.',
    ],
    live: [
      ['Lưu lượng nước thô', s => `${f0(s.qRaw)} m³/h`],
      ['Mực nước sông', s => `+${f2(s.riverLevel)} m`],
    ],
    scene: 'map',
    cam: { center: ll(INTAKE.originLonLat), zoom: 17.6, pitch: 60, bearing: 40 },
  },
  {
    chapter: 'Nguồn nước',
    title: 'Tuyến ống chính và dòng chảy',
    body: [
      'Ống nâu là nước thô D600 về nhà máy, ống xanh đậm là ống truyền dẫn nước sạch D1000 ra mạng lưới. Mũi tên trắng trên thân ống chỉ hướng nước chảy, chạy nhanh hơn khi lưu lượng lớn.',
      'Nhãn trên tuyến cho biết cỡ ống và lưu lượng hiện tại. Chỗ hai tuyến cắt nhau, ống nhỏ bắc qua ống lớn.',
    ],
    scene: 'map',
    cam: { center: [105.4985, 21.2045], zoom: 14.8, pitch: 55, bearing: 20 },
    show: ['legend'],
  },
  {
    chapter: 'Nguồn nước',
    title: 'Nhà máy nước sạch Sông Hồng',
    body: [
      'Công suất 29.000 m³/ngày đêm. Mặt bằng, các hạng mục và vị trí lấy từ bản vẽ quy hoạch tổng mặt bằng.',
      'Bấm vào nhà máy trên bản đồ để vào mô hình 3D bên trong, nơi mỗi thiết bị đều xem và điều khiển được.',
    ],
    live: [
      ['Phát ra mạng', s => `${f0(s.qOut)} m³/h`],
      ['Áp lực ra', s => `${f2(s.pOut)} bar`],
      ['Bể chứa', s => `${f0(s.reservoirPct)} %`],
    ],
    scene: 'map',
    cam: { center: ll(PLANT.originLonLat), zoom: 16.2, pitch: 58, bearing: 14 },
  },
  {
    chapter: 'Mạng lưới',
    title: 'Điểm cấp nước vào vùng',
    body: [
      'Ống D1000 chia nhánh qua tê thu DN1000×300 vào đường ống D315 của vùng. Trên nhánh có trạm đầu vùng: van điều khiển, đồng hồ tổng, cảm biến áp lực, cảm biến clo dư và RTU truyền số liệu.',
      'Bảng bên phải là thông tin của đồng hồ tổng FT-VT3, như khi bạn bấm vào một thiết bị trên bản đồ.',
    ],
    scene: 'map',
    cam: { center: ll(ENTRY_LONLAT), zoom: 18.6, pitch: 60, bearing: 190 },
    show: ['drawer'],
    card: 'left',
    run: c => {
      c.map.select({ type: 'device', id: 'FT-VT3' })
      return () => c.map.select(null)
    },
  },
  {
    chapter: 'Mạng lưới',
    title: 'Mạng lưới phân phối và áp lực',
    body: [
      'Ống phân phối HDPE D90–D315 từ bản vẽ thiết kế, tô màu theo áp lực tính từ mô phỏng: xanh lam là áp cao, đỏ là áp thấp, xám là đoạn mất nước.',
      'Biểu đồ bên phải theo dõi cột áp đầu vùng, lưu lượng vào vùng, áp lực thấp nhất và clo dư. Mỗi biểu đồ thu nhỏ được thành một nhãn.',
    ],
    scene: 'map',
    cam: { center: [105.4952, 21.1922], zoom: 15.1, pitch: 50, bearing: 0 },
    show: ['legend', 'charts'],
    card: 'left',
    run: c => c.map.setMode('pressure'),
  },
  {
    chapter: 'Mạng lưới',
    title: 'Cảm biến áp lực tại điểm bất lợi',
    body: [
      'Ở hai điểm xa nhất của mạng có cảm biến áp lực kèm RTU, gửi số liệu qua 4G mỗi 5 phút. Đây là nơi áp lực xuống thấp nhất khi nhu cầu cao.',
      'Nhãn nổi trên bản đồ hiện giá trị đo trực tiếp; viền chuyển vàng hoặc đỏ khi áp lực dưới ngưỡng.',
    ],
    scene: 'map',
    cam: { center: [105.5055, 21.164], zoom: 16.9, pitch: 56, bearing: 0 },
    show: ['drawer'],
    card: 'left',
    run: c => {
      c.map.select({ type: 'device', id: 'PT-VT3-02' })
      return () => c.map.select(null)
    },
  },
  {
    chapter: 'Mạng lưới',
    title: 'Mạng lưới dịch vụ',
    body: [
      '824 đoạn ống dịch vụ D50/D63 nối từ ống phân phối tới các cụm đồng hồ khách hàng, qua 186 đai khởi thủy.',
      'Mọi điểm nối đều có phụ kiện đúng loại: tê, tê thu, cút theo góc thật, côn và bịt đầu, lấy từ bản vẽ ống dịch vụ.',
    ],
    scene: 'map',
    cam: { center: [105.49446, 21.19343], zoom: 19.6, pitch: 58, bearing: -30 },
    show: ['drawer'],
    card: 'left',
    run: c => {
      c.map.select({ type: 'device', id: 'DKT-1' })
      return () => c.map.select(null)
    },
  },
  {
    chapter: 'Mạng lưới',
    title: 'Đóng van để cô lập một nhánh',
    body: [
      'Van chặn V.1 vừa được đóng. Mô phỏng tính lại ngay: toàn bộ nhánh phía sau van mất nước và chuyển sang màu xám, các thiết bị trên nhánh báo mất kết nối.',
      'Khi rời bước này, van được mở lại.',
    ],
    tip: 'Bấm vào một van trên bản đồ, rồi chọn Đóng van hoặc Mở van.',
    scene: 'map',
    cam: { center: [105.4938, 21.1928], zoom: 17.2, pitch: 55, bearing: 10 },
    show: ['drawer', 'legend'],
    card: 'left',
    run: c => {
      if (!c.sim.closedNetValves.has('V.1')) c.sim.toggleNetValve('V.1')
      c.map.select({ type: 'valve', code: 'V.1' })
      return () => {
        if (c.sim.closedNetValves.has('V.1')) c.sim.toggleNetValve('V.1')
        c.map.select(null)
      }
    },
  },
  {
    chapter: 'Mạng lưới',
    title: 'Phát hiện rò rỉ',
    body: [
      'Thiết bị nghe rò NR-3 gắn trên van ghi tiếng ồn ban đêm. Mức 38 dB cao bất thường so với các điểm khác: khả năng có rò rỉ gần đó, cần đội hiện trường nghe kiểm tra.',
    ],
    scene: 'map',
    cam: { center: [105.49227, 21.19058], zoom: 18.2, pitch: 58, bearing: 20 },
    show: ['drawer'],
    card: 'left',
    run: c => {
      c.map.select({ type: 'device', id: 'AL-3' })
      return () => c.map.select(null)
    },
  },
  {
    chapter: 'Mạng lưới',
    title: 'Các công cụ của bản đồ',
    body: [
      'Thanh bên trái mở các bảng: Tổng quan, Lớp bản đồ (nền vệ tinh, bật tắt lớp ống, tô màu theo áp lực, vận tốc, đường kính), Danh mục thành phần và Hiệu năng.',
      'Thanh trên cùng có đồng hồ mô phỏng (chạy nhanh, tạm dừng, thử tình huống sự cố), chuông báo động và nút mở SCADA trung tâm.',
    ],
    tip: 'Đổi nền bản đồ sang Vệ tinh trong bảng Lớp bản đồ.',
    scene: 'map',
    cam: HOME,
    show: ['top', 'rail', 'fly'],
    card: 'right',
    run: c => {
      c.map.setFly('layers')
      return () => c.map.setFly(null)
    },
  },
  {
    chapter: 'Nhà máy',
    title: 'Bên trong nhà máy',
    body: [
      'Mô hình 3D của nhà máy: hồ sơ lắng, trạm bơm chuyển tiếp, bể trộn và phản ứng, lắng lamella, bể lọc, bể chứa, trạm bơm nước sạch, nhà hóa chất và nhà clo.',
      'Sơ đồ công nghệ trên cùng đi theo dòng nước từ sông tới mạng lưới, mỗi bước có số liệu trực tiếp. Bấm một bước để bay tới hạng mục đó.',
    ],
    scene: 'factory',
    site: 'plant',
    show: ['process'],
    run: c => c.factory.overview('plant'),
  },
  {
    chapter: 'Nhà máy',
    title: 'Trộn, phản ứng và lắng',
    body: [
      'Nước thô được trộn với PAC, keo tụ qua ba bậc phản ứng cơ khí rồi lắng qua các tấm lamella. Liều PAC tự tăng theo độ đục nước thô.',
      'Thẻ bên phải cho biết trạng thái từng hạng mục và liệt kê thiết bị bên trong.',
    ],
    live: [
      ['Đục sau lắng', s => `${f1(s.settledTurb)} NTU`],
      ['Liều PAC', s => `${f1(s.pacDose)} mg/L`],
    ],
    scene: 'factory',
    show: ['process', 'drawer'],
    card: 'left',
    run: c => {
      c.factory.pickUnit('S04')
      return () => c.factory.closeDrawer()
    },
  },
  {
    chapter: 'Nhà máy',
    title: 'Bể lọc và rửa lọc',
    body: [
      'Bốn bể lọc nhanh. Khi tổn thất áp qua lớp cát vượt 2,2 m hoặc sau 48 giờ lọc, bể tự rửa: hạ nước, sục khí, gió và nước, rửa nước rồi làm đầy.',
      'Bể lọc số 1 vừa được lệnh rửa, bạn đang xem nó chạy qua từng pha.',
    ],
    tip: 'Bấm một thiết bị trong nhà máy để mở bảng điều khiển của nó.',
    scene: 'factory',
    show: ['drawer'],
    card: 'left',
    run: c => {
      c.factory.pickTag('F-501')
      if (c.sim.dev['F-501']?.phase === 'filter') c.sim.command('F-501', 'wash')
      return () => c.factory.closeDrawer()
    },
  },
  {
    chapter: 'Nhà máy',
    title: 'Bơm nước sạch',
    body: [
      'Ba bơm 850 m³/h có biến tần, tự giữ áp lực ra mạng 4,2 bar. Ở chế độ TAY, vận hành viên chạy, dừng bơm và đặt tần số; ở TỰ ĐỘNG, các lệnh bị khóa.',
      'Bảng điều khiển hiển thị lưu lượng, cột áp, công suất, giờ chạy và cho phép mô phỏng sự cố để diễn tập.',
    ],
    live: [
      ['Áp lực ra', s => `${f2(s.pOut)} bar`],
      ['Điện năng', s => `${f2(s.specificEnergy)} kWh/m³`],
    ],
    scene: 'factory',
    show: ['drawer'],
    card: 'left',
    run: c => {
      c.factory.pickTag('P-NS-01')
      return () => c.factory.closeDrawer()
    },
  },
  {
    chapter: 'Nhà máy',
    title: 'Theo dõi chất lượng và sản lượng',
    body: [
      'Các biểu đồ 24 giờ của nhà máy: áp lực ra, lưu lượng phát, mực bể chứa, độ đục sau lọc, clo dư và độ đục nước thô, có dải ngưỡng vận hành.',
      'Biểu đồ nào ra ngoài ngưỡng sẽ đổi màu; bấm vào để bay tới hạng mục liên quan.',
    ],
    scene: 'factory',
    show: ['charts', 'top'],
    card: 'left',
    run: c => c.factory.overview('plant'),
  },
  {
    chapter: 'SCADA',
    title: 'SCADA trung tâm',
    body: [
      'Màn hình SCADA theo phong cách Siemens iX: sơ đồ công nghệ toàn nhà máy với số đo của từng cảm biến, đồng hồ áp lực, mực bể chứa và độ đục.',
      'Bấm một ký hiệu trên sơ đồ để mở bảng điều khiển của thiết bị đó. Các tab bên trên chuyển giữa các khu vực.',
    ],
    scene: 'factory',
    card: 'left',
    run: c => {
      c.openHmi({ mode: 'scada', screen: 'overview' })
      return () => c.openHmi(null)
    },
  },
  {
    chapter: 'SCADA',
    title: 'Màn hình cụm bể lọc',
    body: ['Trạng thái từng bể lọc, chênh áp, thời gian lọc và lưu lượng; nút rửa lọc cho từng bể. Bể số 1 đang trong chu trình rửa từ bước trước.'],
    scene: 'factory',
    card: 'left',
    run: c => {
      c.openHmi({ mode: 'scada', screen: 'filters' })
      return () => c.openHmi(null)
    },
  },
  {
    chapter: 'SCADA',
    title: 'Sự cố và báo động',
    body: [
      'Bơm nước sạch số 1 vừa được cho sự cố. Báo động xuất hiện ngay, bơm dự phòng tự chạy để giữ áp lực ra mạng.',
      'Danh sách báo động ghi thời gian, mức độ và cho phép xác nhận. Nhật ký vận hành lưu lại mọi lệnh.',
    ],
    scene: 'factory',
    card: 'left',
    run: c => {
      c.sim.command('P-NS-01', 'fault')
      c.openHmi({ mode: 'scada', screen: 'alarms' })
      return () => {
        c.openHmi(null)
        c.sim.command('P-NS-01', 'reset')
      }
    },
  },
  {
    chapter: 'Kết thúc',
    title: 'Bắt đầu sử dụng',
    body: [
      'Bạn đã đi qua nguồn nước, mạng lưới, nhà máy và SCADA. Giờ bản đồ là của bạn: kéo để di chuyển, chuột phải để xoay, bấm vào mọi thứ để xem số liệu.',
      'Có thể xem lại phần trình diễn này bất cứ lúc nào bằng nút Demo trên thanh trên cùng.',
    ],
    scene: 'map',
    cam: HOME,
  },
]

const SEEN = 'tw.tour.seen'
const [step, setStep] = createSignal(-1)
/** the step on show, -1 when the tour is not running */
export const tourStep = step
export const touring = () => step() >= 0
export const startTour = () => setStep(0)
export const stopTour = () => {
  setStep(-1)
  try {
    localStorage.setItem(SEEN, '1')
  } catch {
    /* private mode */
  }
}
export const tourSeen = () => {
  try {
    return localStorage.getItem(SEEN) === '1'
  } catch {
    return true
  }
}

/** the "Demo" button for the top bars */
export function TourButton() {
  return (
    <button type="button" class="tw-btn ghost" onClick={startTour} title="Xem trình diễn các tính năng">
      <Play size={15} />
      <span class="tw-hide-narrow">Demo</span>
    </button>
  )
}

/**
 * Runs the tour: moves between scenes, applies each step, and draws the card and the bar.
 * `scene` / `setScene` are the page's current screen; `openHmi` opens or closes the SCADA.
 */
export function Tour(props: {
  scene: 'map' | 'factory'
  goMap: () => void
  openHmi: (t: HmiTarget | null) => void
  root: () => HTMLElement | undefined
}) {
  const { sim, v } = useSim()
  const cur = createMemo(() => (step() >= 0 ? STEPS[step()] : undefined))
  let undo: (() => void) | undefined
  let timers: number[] = []
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms))
  const clearTimers = () => {
    timers.forEach(t => window.clearTimeout(t))
    timers = []
  }
  const leaveStep = () => {
    clearTimers()
    undo?.()
    undo = undefined
  }

  createEffect(
    on(step, (i, prev) => {
      // nothing to undo or apply while the tour is not running (it mounts with the page)
      if (i < 0 && (prev ?? -1) < 0) return
      leaveStep()
      const root = props.root()
      const s = i >= 0 ? STEPS[i] : undefined
      director.map?.lock(!!s)
      director.factory?.lock(!!s)
      if (root) {
        if (s) root.dataset.tour = ['on', ...(s.show ?? [])].join(' ')
        else {
          delete root.dataset.tour
          // the panels slide back in
          root.classList.add('tw-tour-out')
          window.setTimeout(() => root.classList.remove('tw-tour-out'), 900)
        }
      }
      if (!s) return
      const map = director.map
      const factory = director.factory
      if (!map || !factory) return
      const apply = () => {
        if (s.scene === 'map' && s.cam) map.fly(s.cam)
        const r = s.run?.({ map, factory, sim, openHmi: props.openHmi })
        undo = typeof r === 'function' ? r : undefined
      }
      if (s.scene === 'factory' && props.scene === 'map') {
        // into the plant with the map's own transition, then the step
        map.enter(s.site ?? 'plant')
        later(apply, 2300)
      } else if (s.scene === 'map' && props.scene === 'factory') {
        props.goMap()
        later(apply, 600)
      } else apply()
    }),
  )
  onCleanup(leaveStep)

  const next = () => (step() < STEPS.length - 1 ? setStep(step() + 1) : stopTour())
  const prev = () => step() > 0 && setStep(step() - 1)
  const onKey = (e: KeyboardEvent) => {
    if (!touring() || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return
    if (e.key === 'ArrowRight') next()
    else if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'Escape' && !document.querySelector('.hm-backdrop')) stopTour()
  }
  window.addEventListener('keydown', onKey)
  onCleanup(() => window.removeEventListener('keydown', onKey))

  const chapters = createMemo(() => {
    const out: Array<{ name: string; from: number; to: number }> = []
    STEPS.forEach((s, i) => {
      const last = out[out.length - 1]
      if (last && last.name === s.chapter) last.to = i
      else out.push({ name: s.chapter, from: i, to: i })
    })
    return out
  })

  return (
    <Show when={cur()}>
      {s => (
        <div class="tw-tour" aria-live="polite">
          <Show when={s()} keyed>
            {st => (
              <section class={`tw-tour-card tw-glass ${st.card ?? 'right'}`} aria-label="Thuyết minh">
                <div class="tw-tour-chapter">{st.chapter}</div>
                <h2>{st.title}</h2>
                <For each={st.body}>{p => <p>{p}</p>}</For>
                <Show when={st.live?.length}>
                  <dl class="tw-tour-live">
                    <For each={st.live}>
                      {([k, f]) => (
                        <>
                          <dt>{k}</dt>
                          <dd>{(v(), f(sim))}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </Show>
                <Show when={st.tip}>
                  <p class="tw-tour-tip">
                    <b>Tự thử:</b> {st.tip}
                  </p>
                </Show>
              </section>
            )}
          </Show>
          <nav class="tw-tour-bar tw-glass" aria-label="Điều hướng trình diễn">
            <button type="button" class="tw-tour-nav" onClick={prev} disabled={step() === 0} aria-label="Bước trước">
              <ChevronLeft size={18} />
              <span>Trước</span>
            </button>
            <div class="tw-tour-steps">
              <For each={chapters()}>
                {c => (
                  <div class="tw-tour-ch" classList={{ on: step() >= c.from && step() <= c.to }}>
                    <span class="name">{c.name}</span>
                    <span class="dots">
                      <For each={Array.from({ length: c.to - c.from + 1 }, (_, k) => c.from + k)}>
                        {i => (
                          <button
                            type="button"
                            classList={{ done: i < step(), cur: i === step() }}
                            onClick={() => setStep(i)}
                            aria-label={`Bước ${i + 1}: ${STEPS[i]!.title}`}
                            title={STEPS[i]!.title}
                          />
                        )}
                      </For>
                    </span>
                  </div>
                )}
              </For>
            </div>
            <span class="tw-tour-count">
              {step() + 1}/{STEPS.length}
            </span>
            <button type="button" class="tw-tour-nav primary" onClick={next}>
              <span>{step() === STEPS.length - 1 ? 'Bắt đầu' : 'Tiếp'}</span>
              <ChevronRight size={18} />
            </button>
            <button type="button" class="tw-tour-x" onClick={stopTour} aria-label="Thoát trình diễn" title="Thoát (Esc)">
              <X size={16} />
            </button>
          </nav>
        </div>
      )}
    </Show>
  ) as JSX.Element
}
