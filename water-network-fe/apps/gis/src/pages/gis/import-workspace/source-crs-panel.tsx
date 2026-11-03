import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import type { createImportWorkspace } from './workspace'
import { isProcessing, type ReviewConfig } from './types'
import { vn2000Localities, vn2000CatalogVersion } from './vn2000-catalog'
import { importButton as button, importField as field } from './ui'

type Projection = '' | 'TM3' | 'UTM48N' | 'UTM49N'
type SourceSettings = Pick<
  ReviewConfig,
  'sourceCrs' | 'sourceAxisOrder' | 'sourceUnits' | 'sourceCrsPresetId'
>
const sourceSettings = (config: ReviewConfig | null): SourceSettings => ({
  sourceCrs: config?.sourceCrs ?? null,
  sourceAxisOrder: config?.sourceAxisOrder ?? 'xy',
  sourceUnits: config?.sourceUnits ?? 'm',
  sourceCrsPresetId: config?.sourceCrsPresetId ?? null,
})

export function SourceCrsPanel(props: { workspace: ReturnType<typeof createImportWorkspace> }) {
  const w = props.workspace
  const [draft, setDraft] = createSignal<SourceSettings>(sourceSettings(w.config()))
  const [localityId, setLocalityId] = createSignal('')
  const [projection, setProjection] = createSignal<Projection>('')
  const [evidence, setEvidence] = createSignal(w.config()?.crsEvidence ?? '')
  const [confirmed, setConfirmed] = createSignal(false)
  const conflict = createMemo(
    () =>
      !!w.config()?.controlPoints?.length ||
      !!w.config()?.controlPointTargetCrs ||
      !!w.config()?.fileCrs?.length
  )
  const locality = createMemo(() => vn2000Localities.find(item => item.id === localityId()))
  const preset = createMemo(() => {
    const place = locality()
    const kind = projection()
    if (!place || !kind) return null
    return {
      id: `${place.id}:${kind}`,
      epsg: kind === 'TM3' ? place.epsg : kind === 'UTM48N' ? 3405 : 3406,
      centralMeridian: kind === 'TM3' ? place.centralMeridian : kind === 'UTM48N' ? 105 : 111,
      scaleFactor: kind === 'TM3' ? 0.9999 : 0.9996,
    }
  })
  const resetFromConfig = () => {
    const settings = sourceSettings(w.config())
    setDraft(settings)
    const [id, kind] = settings.sourceCrsPresetId?.split(':') ?? []
    setLocalityId(vn2000Localities.some(item => item.id === id) ? id! : '')
    setProjection(['TM3', 'UTM48N', 'UTM49N'].includes(kind ?? '') ? (kind as Projection) : '')
    setEvidence(w.config()?.crsEvidence ?? '')
    setConfirmed(false)
  }
  const jobRevision = createMemo(() => `${w.job()?.id ?? ''}:${w.job()?.version ?? 0}`)
  createEffect(on(jobRevision, resetFromConfig))
  const stage = (change: Partial<SourceSettings>) => {
    if (w.locked()) return
    const next = { ...draft(), ...change }
    setDraft(next)
    setConfirmed(false)
    if (!conflict()) w.edit(config => ({ ...config, ...next, crsEvidence: '' }))
  }
  const chooseProjection = (kind: Projection) => {
    setProjection(kind)
    const selected = preset()
    stage({
      sourceCrs: selected ? `EPSG:${selected.epsg}` : null,
      sourceCrsPresetId: selected?.id ?? null,
    })
  }
  const chooseLocality = (id: string) => {
    setLocalityId(id)
    setProjection('')
    stage({ sourceCrs: null, sourceCrsPresetId: null })
  }
  const convertMode = () => {
    if (w.locked() || !draft().sourceCrs?.trim()) return
    w.edit(config => ({
      ...config,
      ...draft(),
      controlPoints: [],
      controlPointTargetCrs: null,
      fileCrs: [],
      crsEvidence: '',
    }))
    setConfirmed(false)
  }
  const previewCurrent = createMemo(
    () =>
      !conflict() &&
      !w.dirty() &&
      !isProcessing(w.job()) &&
      !!w.config()?.sourceCrs?.trim() &&
      (w.preview()?.drawing?.coordinateSpace ?? w.preview()?.coordinateSpace) === 'EPSG:4326' &&
      w.preview()?.version === w.job()?.version
  )
  const preview = async () => {
    if (w.locked() || conflict() || !draft().sourceCrs?.trim()) return
    setConfirmed(false)
    w.edit(config => ({ ...config, ...draft(), crsEvidence: '' }))
    await w.save()
    if (!w.error()) w.setView('clean')
  }
  const saveEvidence = async () => {
    if (w.locked() || !previewCurrent() || !confirmed() || !evidence().trim()) return
    w.edit(config => ({ ...config, crsEvidence: evidence().trim() }))
    await w.save()
    if (!w.error()) w.setView('clean')
  }

  return (
    <section aria-label="Khai báo hệ tọa độ nguồn" class="space-y-3 p-3 text-xs">
      <p class="leading-5 text-[color:var(--muted)]">
        Chọn theo thông tin trong hồ sơ đo đạc. Tỉnh dùng danh mục địa chính tại thời điểm lập hồ
        sơ; không tự suy hệ tọa độ từ vị trí công trình.
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="min-w-0">
          Tỉnh / địa bàn trong hồ sơ
          <select
            aria-label="Địa bàn VN-2000"
            class={`${field} mt-1`}
            value={localityId()}
            disabled={w.locked()}
            onChange={e => chooseLocality(e.currentTarget.value)}
          >
            <option value="">Chọn địa bàn lịch sử</option>
            <For each={vn2000Localities}>
              {item => <option value={item.id}>{item.label}</option>}
            </For>
          </select>
        </label>
        <label class="min-w-0">
          Phép chiếu
          <select
            aria-label="Phép chiếu VN-2000"
            class={`${field} mt-1`}
            value={projection()}
            disabled={w.locked() || !locality()}
            onChange={e => chooseProjection(e.currentTarget.value as Projection)}
          >
            <option value="">Chọn theo hồ sơ</option>
            <option value="TM3">TM-3 · múi 3° theo địa bàn</option>
            <option value="UTM48N">UTM múi 48 Bắc · 6°</option>
            <option value="UTM49N">UTM múi 49 Bắc · 6°</option>
          </select>
        </label>
      </div>
      <Show when={preset()}>
        {selected => (
          <div class="grid grid-cols-2 gap-2 rounded-lg border border-line bg-[var(--surface2)] p-2 text-[11px]">
            <span>
              Mã CRS <b class="font-mono">EPSG:{selected().epsg}</b>
            </span>
            <span>
              Kinh tuyến trục <b>{selected().centralMeridian}°</b>
            </span>
            <span>
              Hệ số k₀ <b>{selected().scaleFactor}</b>
            </span>
            <span>
              Đơn vị CRS <b>Mét</b>
            </span>
          </div>
        )}
      </Show>
      <div class="grid gap-2 sm:grid-cols-2">
        <label>
          Thứ tự số trong CAD
          <select
            aria-label="Thứ tự trục CAD"
            class={`${field} mt-1`}
            value={draft().sourceAxisOrder}
            disabled={w.locked()}
            onChange={e => stage({ sourceAxisOrder: e.currentTarget.value as 'xy' | 'yx' })}
          >
            <option value="xy">XY · Đông (E), Bắc (N)</option>
            <option value="yx">YX · Bắc (N), Đông (E)</option>
          </select>
        </label>
        <label>
          Đơn vị số trong CAD
          <select
            aria-label="Đơn vị tọa độ CAD"
            class={`${field} mt-1`}
            value={draft().sourceUnits}
            disabled={w.locked()}
            onChange={e => stage({ sourceUnits: e.currentTarget.value as 'm' | 'mm' })}
          >
            <option value="m">Mét (m)</option>
            <option value="mm">Milimét (mm)</option>
          </select>
        </label>
      </div>
      <p class="text-[10px] leading-4 text-[color:var(--muted)]">
        Trắc địa thường gọi X là Bắc, Y là Đông. Chọn theo thứ tự số thực tế được lưu trong bản vẽ;
        bản gốc luôn được giữ nguyên.
      </p>
      <details>
        <summary class="cursor-pointer text-[11px]">Nâng cao · nhập mã EPSG / chuỗi PROJ</summary>
        <label class="mt-2 block">
          Hệ tọa độ nguồn tùy chỉnh
          <input
            aria-label="Hệ tọa độ nguồn tùy chỉnh"
            class={`${field} mt-1 font-mono`}
            value={draft().sourceCrs ?? ''}
            disabled={w.locked()}
            placeholder="EPSG:… hoặc PROJ từ hồ sơ đã xác định"
            onInput={e => {
              setProjection('')
              stage({ sourceCrs: e.currentTarget.value || null, sourceCrsPresetId: null })
            }}
          />
        </label>
      </details>
      <Show when={conflict()}>
        <div
          role="alert"
          class="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900"
        >
          <p>
            Hồ sơ đang dùng điểm ghép hoặc CRS riêng từng tệp. Chuyển cách định vị sẽ bỏ cấu hình đó
            khỏi bản nháp; có thể dùng “Bỏ thay đổi chưa áp dụng” để khôi phục trước khi lưu.
          </p>
          <button
            type="button"
            class={button}
            disabled={w.locked() || !draft().sourceCrs?.trim()}
            onClick={convertMode}
          >
            Chuyển sang hệ tọa độ đã chọn
          </button>
        </div>
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class={`${button} bg-sky-700 text-white hover:!bg-sky-800`}
          disabled={w.locked() || conflict() || !draft().sourceCrs?.trim()}
          onClick={() => void preview()}
        >
          Xem trên bản đồ
        </button>
        <span class="font-mono text-[11px]">
          {draft().sourceCrs?.startsWith('EPSG:')
            ? draft().sourceCrs
            : draft().sourceCrs
              ? 'CRS tùy chỉnh'
              : 'Chưa chọn CRS'}
        </span>
      </div>
      <p class="text-[10px] leading-4 text-[color:var(--muted)]">
        Xem trước không xác nhận tài sản. Cần đối chiếu đường, mốc đo và hồ sơ gốc trước khi ghi căn
        cứ.
      </p>
      <Show when={previewCurrent()}>
        <div class="space-y-2 border-t border-line pt-3">
          <p role="status" class="text-[11px] leading-5 text-sky-800">
            Đã chuyển bản xem trước theo cấu hình đã khai báo.{' '}
            {w.config()?.crsEvidence
              ? 'Căn cứ xác nhận đã được lưu.'
              : 'Chưa xác nhận tọa độ; chưa đủ điều kiện tạo bản nháp GIS.'}
          </p>
          <label class="block">
            Căn cứ xác nhận vị trí
            <textarea
              aria-label="Căn cứ xác nhận hệ tọa độ"
              class={`${field} mt-1`}
              rows={2}
              maxlength={4000}
              value={evidence()}
              onInput={e => {
                setEvidence(e.currentTarget.value)
                setConfirmed(false)
              }}
              placeholder="Hồ sơ đo đạc, mã mốc, ngày đối soát và kết quả kiểm tra vị trí"
              disabled={w.locked()}
            />
          </label>
          <label class="flex items-start gap-2 text-[11px] leading-5">
            <input
              type="checkbox"
              class="mt-1"
              checked={confirmed()}
              disabled={w.locked() || !evidence().trim()}
              onChange={e => setConfirmed(e.currentTarget.checked)}
            />
            Tôi đã đối chiếu vị trí và xác nhận đúng hệ tọa độ, thứ tự trục, đơn vị.
          </label>
          <button
            type="button"
            class={button}
            disabled={w.locked() || !confirmed() || !evidence().trim()}
            onClick={() => void saveEvidence()}
          >
            Lưu căn cứ xác nhận
          </button>
        </div>
      </Show>
      <Show when={locality()}>
        {place => (
          <p class="text-[10px] leading-4 text-[color:var(--muted)]">
            Danh mục {vn2000CatalogVersion} ·{' '}
            <a class="underline" href={place().sourceUrl} target="_blank" rel="noreferrer">
              Nguồn tra cứu địa bàn
            </a>
          </p>
        )}
      </Show>
    </section>
  )
}
