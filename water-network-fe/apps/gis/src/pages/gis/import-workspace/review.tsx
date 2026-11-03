import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from 'solid-js'
import { createDraftEditor, overlayLineEdits } from './draft-editor'
import { BlockMapping } from './blocks'
import { CadPreview } from './preview'
import { GeoreferenceWorkbench } from './georeference'
import { actionLabels, canSubmitJob, isProcessing, stateLabels, type LayerRule } from './types'
import { importButton as button, importField as field, importNumber as number } from './ui'
import { PREVIEW_LIMIT, type createImportWorkspace } from './workspace'
import { Badge, Btn, Card } from '../ui/kit'

type Workspace = ReturnType<typeof createImportWorkspace>
const layerKey = (rule: Pick<LayerRule, 'fileId' | 'layer'>) =>
  JSON.stringify([rule.fileId, rule.layer])

export function ImportReview(props: {
  draftMap?: boolean
  workspace: Workspace
  jobId: string
  canApprove: boolean
  canSubmit: boolean
}): JSX.Element {
  const w = props.workspace
  const job = () => w.job()!
  const [panel, setPanel] = createSignal<'object' | 'layers' | 'blocks' | 'quality' | 'align'>(
    'object'
  )
  createEffect(() => {
    if (props.draftMap) setPanel('align')
  })
  const [pendingCadPoint, setPendingCadPoint] = createSignal<[number, number] | null>(null)
  const [pickingCad, setPickingCad] = createSignal(false)
  const [cancelPickToken, setCancelPickToken] = createSignal(0)
  const [activePointIndex, setActivePointIndex] = createSignal<number | null>(null)
  const [focusKey, setFocusKey] = createSignal(0)
  const [highlightedIds, setHighlightedIds] = createSignal<string[]>([])
  createEffect(() => {
    if (panel() === 'blocks') w.setView('raw')
    else setHighlightedIds([])
  })
  const activePreview = createMemo(() => {
    const original = panel() === 'align' ? w.rawPreview() : w.preview()
    const page = original
      ? {
          ...original,
          features: original.features.filter(
            f => !w.config()?.excludedFileIds?.includes(f.properties.fileId ?? '')
          ),
        }
      : original
    return page?.coordinateSpace === 'cad'
      ? {
          ...page,
          features: overlayLineEdits(page.features, w.config()).filter(
            f => !w.config()?.excludedFileIds?.includes(f.properties.fileId ?? '')
          ),
        }
      : page
  })
  const [layerSearch, setLayerSearch] = createSignal('')
  const [selectedLayers, setSelectedLayers] = createSignal<Set<string>>(new Set())
  const [fileFilter, setFileFilter] = createSignal('')
  const [layerFilter, setLayerFilter] = createSignal('')
  const [selectedId, setSelectedId] = createSignal('')
  const [featureSearch, setFeatureSearch] = createSignal('')
  const [publishReason, setPublishReason] = createSignal('')
  const [lifecycleEvidence, setLifecycleEvidence] = createSignal('')
  const fileNames = createMemo(() => new Map(job().files.map(file => [file.id, file.name])))
  const filteredRules = createMemo(
    () =>
      w
        .config()
        ?.layerRules.filter(
          rule =>
            !w.config()?.excludedFileIds?.includes(rule.fileId) &&
            (!fileFilter() || rule.fileId === fileFilter()) &&
            rule.layer.toLocaleLowerCase().includes(layerSearch().toLocaleLowerCase())
        ) ?? []
  )
  const features = createMemo(
    () =>
      activePreview()?.features.filter(
        feature =>
          (!fileFilter() || feature.properties.fileId === fileFilter()) &&
          (!layerFilter() || feature.properties.layer === layerFilter())
      ) ?? []
  )
  const layerOptions = createMemo(() => [
    ...new Set(
      w
        .config()
        ?.layerRules.filter(rule => !fileFilter() || rule.fileId === fileFilter())
        .map(rule => rule.layer)
    ),
  ])
  const selectedFeature = createMemo(() =>
    activePreview()?.features.find(feature => feature.id === selectedId())
  )
  const editor = createDraftEditor(w, selectedFeature, setSelectedId, () => {
    setPanel('object')
    w.setView('raw')
    setFileFilter('')
    setLayerFilter('')
  })
  createEffect(() => w.setSketchActive(editor.active()))
  onCleanup(() => w.setSketchActive(false))
  const listedFeatures = createMemo(() =>
    features().filter(feature =>
      `${feature.id} ${feature.properties.layer ?? ''} ${feature.properties.text ?? ''}`
        .toLocaleLowerCase()
        .includes(featureSearch().toLocaleLowerCase())
    )
  )
  const issues = createMemo(() => job().issues ?? job().inventory?.issues ?? [])
  const [activeIssue, setActiveIssue] = createSignal<ReturnType<typeof issues>[number] | null>(null)
  createEffect(() => {
    job().version
    setActiveIssue(null)
  })
  function locateIssue(issue: ReturnType<typeof issues>[number]) {
    editor.cancel()
    setActiveIssue(issue)
    setPanel(issue.featureId ? 'object' : 'quality')
    w.setView('raw')
    setFileFilter('')
    setLayerFilter('')
    setSelectedId(issue.featureId ?? '')
    setFeatureSearch('')
    setFocusKey(value => value + 1)
  }
  const [issueSeverity, setIssueSeverity] = createSignal('all')
  const [issueCode, setIssueCode] = createSignal('')
  const [issueSearch, setIssueSearch] = createSignal('')
  const [issuePage, setIssuePage] = createSignal(0)
  const issueCodes = createMemo(() => [...new Set(issues().map(issue => issue.code))].sort())
  const filteredIssues = createMemo(() =>
    issues().filter(
      issue =>
        (issueSeverity() === 'all' || issue.severity === issueSeverity()) &&
        (!issueCode() || issue.code === issueCode()) &&
        `${issue.code} ${issue.message} ${issue.featureId ?? ''}`
          .toLocaleLowerCase()
          .includes(issueSearch().toLocaleLowerCase())
    )
  )
  createEffect(() => {
    issueSeverity()
    issueCode()
    issueSearch()
    job().version
    setIssuePage(0)
  })
  const issueHelp = (code: string) =>
    (
      ({
        CLOSED_PIPE:
          'Nếu là ký hiệu: chuyển lớp sang tham chiếu hoặc loại đối tượng. Nếu là ống thật: chọn tuyến, dùng Tách tuyến tại nút phù hợp rồi lưu và kiểm tra lại.',
        MISSING_PIPE_ATTRIBUTES:
          'Mở Lớp dữ liệu để điền đường kính và vật liệu theo hồ sơ. Chỉ áp dụng chung khi cả lớp cùng thông số.',
        POSSIBLE_TEE: 'Đối chiếu điểm đấu nối thực tế; không tự coi mọi giao cắt là đấu nối.',
        NEAR_OVERLAPPING_ROUTES:
          'So sánh hai tuyến, giữ tuyến đúng. Chỉ loại tuyến còn lại khi xác nhận là bản vẽ trùng.',
        CRS_REQUIRED: 'Mở Căn vị trí trên GIS để khai báo hệ tọa độ hoặc ghép điểm.',
        CRS_EVIDENCE_REQUIRED: 'Đối chiếu vị trí với hồ sơ đo đạc và lưu căn cứ xác nhận.',
        MISSING_XREF:
          'Bổ sung bản vẽ tham chiếu còn thiếu hoặc xác nhận nó chỉ là nền sau khi đối soát.',
      }) as Record<string, string>
    )[code]
  const warningGroups = createMemo(() => {
    const groups = new Map<string, { message: string; count: number }>()
    issues()
      .filter(issue => issue.severity === 'warning')
      .forEach(issue => {
        const current = groups.get(issue.code)
        groups.set(issue.code, {
          message: current?.message ?? issue.message,
          count: (current?.count ?? 0) + 1,
        })
      })
    return [...groups].map(([code, detail]) => ({ code, ...detail }))
  })
  const publishDisabled = () =>
    w.busy() ||
    !props.canApprove ||
    w.dirty() ||
    !(lifecycleEvidence().trim() || job().reviewConfig?.lifecycleEvidence?.trim()) ||
    !publishReason().trim()
  function updateRule(key: string, change: Partial<LayerRule>) {
    w.edit(config => ({
      ...config,
      layerRules: config.layerRules.map(rule =>
        layerKey(rule) === key ? { ...rule, ...change } : rule
      ),
    }))
  }
  function toggleExclude(id: string) {
    w.edit(config => ({
      ...config,
      excludeFeatureIds: config.excludeFeatureIds.includes(id)
        ? config.excludeFeatureIds.filter(value => value !== id)
        : [...config.excludeFeatureIds, id],
    }))
  }
  const submit = () => {
    const current = job()
    if (props.canSubmit && canSubmitJob(current, w.dirty()))
      void w.mutate(client => client.submit(current.id, current.version, current.name))
  }
  const publish = () => {
    const current = job()
    if (!publishDisabled())
      void w.mutate(client =>
        client.publish(
          current.id,
          current.version,
          publishReason().trim(),
          lifecycleEvidence().trim() || current.reviewConfig?.lifecycleEvidence
        )
      )
  }
  // Load the bounded source preview progressively so the first map includes every file.
  createEffect(() => {
    const page = w.preview()
    if (
      page?.hasMore &&
      !w.previewLoading() &&
      !w.previewError() &&
      page.features.length < PREVIEW_LIMIT
    )
      void w.loadMore()
  })
  // A reopened saved alignment needs the server's geographic result as well as original CAD.
  createEffect(() => {
    const raw = w.rawPreview()
    if (
      panel() === 'align' &&
      raw &&
      (!raw.hasMore || raw.features.length >= PREVIEW_LIMIT) &&
      w.view() === 'raw' &&
      !w.dirty() &&
      !isProcessing(w.job()) &&
      ((w.job()?.georeference?.status === 'valid' &&
        w.job()?.georeference?.targetCrs === 'EPSG:4326') ||
        (!!w.config()?.sourceCrs?.trim() && !w.config()?.controlPoints?.length))
    )
      w.setView('clean')
  })
  const selectFeature = (id: string) => {
    setSelectedId(id)
    if (id && panel() !== 'align') setPanel('object')
  }
  const selectedRule = createMemo(() => {
    const feature = selectedFeature()
    return w
      .config()
      ?.layerRules.find(
        rule =>
          rule.fileId === feature?.properties.fileId && rule.layer === feature?.properties.layer
      )
  })
  function cancelPointPicking() {
    setPickingCad(false)
    setPendingCadPoint(null)
    setCancelPickToken(value => value + 1)
  }
  function closeAlignment() {
    setPanel('object')
    w.setView('raw')
    cancelPointPicking()
    setPickingCad(false)
    setPendingCadPoint(null)
  }
  function openAlignment() {
    editor.cancel()
    setPanel('align')
    if (!w.rawPreview()) w.setView('raw')
  }
  const CoordinatesPanel = () => (
    <>
      <Card>
        <h2 class="mb-3 text-sm font-semibold">Tọa độ có sẵn và căn cứ hồ sơ</h2>
        <fieldset disabled={w.locked()} class="grid gap-3 md:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-xs">
            Hệ tọa độ nguồn
            <input
              class={field}
              value={w.config()?.sourceCrs ?? ''}
              placeholder="EPSG:… hoặc chuỗi PROJ đã xác nhận"
              onInput={event =>
                w.edit(config => ({
                  ...config,
                  sourceCrs: event.currentTarget.value || null,
                  sourceCrsPresetId: null,
                  crsEvidence: '',
                }))
              }
            />
            <span class="text-[11px] leading-5 text-[color:var(--muted)]">
              Chưa rõ: để trống để rà soát trong tọa độ bản vẽ. Cần mã CRS, múi chiếu chính xác và
              đơn vị đo trước khi chuyển lên GIS.
            </span>
          </label>
          <label class="flex flex-col gap-1.5 text-xs">
            Căn cứ xác nhận tọa độ
            <textarea
              class={field}
              rows={3}
              value={w.config()?.crsEvidence ?? ''}
              placeholder="Tài liệu đo đạc, điểm khống chế, đơn vị mét/mm và kết quả đối chiếu…"
              onInput={event =>
                w.edit(config => ({ ...config, crsEvidence: event.currentTarget.value }))
              }
            />
          </label>
          <label class="flex flex-col gap-1.5 text-xs md:col-span-2">
            Căn cứ hồ sơ hoàn công / hiện trạng
            <textarea
              class={field}
              rows={2}
              value={w.config()?.lifecycleEvidence ?? ''}
              placeholder="Loại hồ sơ, nguồn xác nhận và tình trạng đã thi công. Chưa xác minh thì để trống."
              onInput={event =>
                w.edit(config => ({ ...config, lifecycleEvidence: event.currentTarget.value }))
              }
            />
            <span class="text-[11px] text-[color:var(--muted)]">
              Bản thiết kế được giữ trong quy trình bản nháp. Xuất bản mạng vận hành cần căn cứ hiện
              trạng được xác nhận.
            </span>
          </label>
        </fieldset>
        <Show when={!w.config()?.sourceCrs && w.config()?.controlPointTargetCrs !== 'EPSG:4326'}>
          <p class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Chưa xác nhận hệ tọa độ. Bạn vẫn có thể lưu bản nháp và chỉnh sửa sau; hồ sơ chưa đủ
            điều kiện Ready để gửi duyệt.
          </p>
        </Show>
      </Card>
    </>
  )
  const LayersPanel = () => (
    <>
      <Card pad={false} class="overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-line p-4">
          <h2 class="text-sm font-semibold">Lớp dữ liệu</h2>
          <p class="text-xs leading-5 text-[color:var(--muted)]">
            Chỉ lớp được xác nhận là tuyến ống mới đi vào mạng. Lớp nền, chú dẫn và đường phụ trợ có
            thể giữ làm tham chiếu hoặc loại. Các gợi ý cần được rà soát.
          </p>
          <div class="grid gap-2">
            <label class="flex flex-col gap-1 text-xs">
              Lọc theo tệp
              <select
                class={field}
                value={fileFilter()}
                onChange={event => {
                  setFileFilter(event.currentTarget.value)
                  setLayerFilter('')
                }}
              >
                <option value="">Tất cả tệp</option>
                <For each={job().files}>{file => <option value={file.id}>{file.name}</option>}</For>
              </select>
            </label>
            <label class="flex flex-col gap-1 text-xs">
              Tìm tên lớp
              <input
                class={field}
                value={layerSearch()}
                onInput={event => setLayerSearch(event.currentTarget.value)}
                placeholder="Tên layer CAD"
              />
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-[color:var(--muted)]">
              {selectedLayers().size} lớp được chọn
            </span>
            <For each={Object.entries(actionLabels)}>
              {([action, label]) => (
                <button
                  type="button"
                  class={button}
                  disabled={w.locked() || !selectedLayers().size}
                  onClick={() =>
                    w.edit(config => ({
                      ...config,
                      layerRules: config.layerRules.map(rule =>
                        selectedLayers().has(layerKey(rule))
                          ? { ...rule, action: action as LayerRule['action'] }
                          : rule
                      ),
                    }))
                  }
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="import-layer-list">
          <table class="import-layer-table">
            <thead class="import-layer-table-heading">
              <tr>
                <th class="p-3">
                  <input
                    aria-label="Chọn tất cả lớp đang lọc"
                    type="checkbox"
                    disabled={w.locked()}
                    checked={
                      !!filteredRules().length &&
                      filteredRules().every(rule => selectedLayers().has(layerKey(rule)))
                    }
                    onChange={event => {
                      const checked = event.currentTarget.checked
                      setSelectedLayers(previous => {
                        const next = new Set(previous)
                        filteredRules().forEach(rule =>
                          checked ? next.add(layerKey(rule)) : next.delete(layerKey(rule))
                        )
                        return next
                      })
                    }}
                  />
                </th>
                <th class="p-3">Lớp / tệp nguồn</th>
                <th class="p-3">Đối tượng</th>
                <th class="p-3">Phân loại</th>
                <th class="p-3">DN (mm)</th>
                <th class="p-3">Vật liệu</th>
              </tr>
            </thead>
            <tbody>
              <Index each={filteredRules()}>
                {rule => {
                  const count = () =>
                    job().inventory?.layers.find(
                      layer => layer.fileId === rule().fileId && layer.name === rule().layer
                    )
                  return (
                    <tr class="import-layer-row">
                      <td class="p-3">
                        <input
                          type="checkbox"
                          aria-label={`Chọn lớp ${rule().layer} ${rule().fileId}`}
                          disabled={w.locked()}
                          checked={selectedLayers().has(layerKey(rule()))}
                          onChange={() =>
                            setSelectedLayers(previous => {
                              const next = new Set(previous)
                              if (next.has(layerKey(rule()))) next.delete(layerKey(rule()))
                              else next.add(layerKey(rule()))
                              return next
                            })
                          }
                        />
                      </td>
                      <td class="max-w-[250px] break-words p-3">
                        <button
                          type="button"
                          class="font-semibold text-sky-700 underline-offset-2 hover:underline"
                          aria-label={`Xem lớp ${rule().layer} ${rule().fileId}`}
                          onClick={() => {
                            setFileFilter(rule().fileId)
                            setLayerFilter(rule().layer)
                            setSelectedId('')
                          }}
                        >
                          {rule().layer}
                        </button>
                        <div class="mt-1 text-[10px] text-[color:var(--muted)]">
                          {fileNames().get(rule().fileId)}
                        </div>
                      </td>
                      <td class="whitespace-nowrap p-3">
                        {number(count()?.count ?? 0)}
                        <div class="text-[10px] text-[color:var(--muted)]">
                          {number(count()?.lineCount ?? 0)} đường ·{' '}
                          {number(count()?.textCount ?? 0)} chữ
                        </div>
                      </td>
                      <td class="p-2">
                        <select
                          class={field}
                          aria-label={`Phân loại ${rule().layer} ${rule().fileId}`}
                          disabled={w.locked()}
                          value={rule().action}
                          onChange={event =>
                            updateRule(layerKey(rule()), {
                              action: event.currentTarget.value as LayerRule['action'],
                            })
                          }
                        >
                          <For each={Object.entries(actionLabels)}>
                            {([value, label]) => <option value={value}>{label}</option>}
                          </For>
                        </select>
                      </td>
                      <td class="w-[100px] p-2">
                        <input
                          class={field}
                          type="number"
                          min="0.01"
                          step="any"
                          aria-label={`Đường kính ${rule().layer} ${rule().fileId}`}
                          disabled={w.locked() || rule().action !== 'pipe'}
                          value={rule().diameterMm ?? ''}
                          onInput={event =>
                            updateRule(layerKey(rule()), {
                              diameterMm: event.currentTarget.value
                                ? Number(event.currentTarget.value)
                                : undefined,
                            })
                          }
                        />
                      </td>
                      <td class="w-[140px] p-2">
                        <input
                          class={field}
                          list="cad-materials"
                          aria-label={`Vật liệu ${rule().layer} ${rule().fileId}`}
                          disabled={w.locked() || rule().action !== 'pipe'}
                          value={rule().material ?? ''}
                          onInput={event =>
                            updateRule(layerKey(rule()), {
                              material: event.currentTarget.value || undefined,
                            })
                          }
                        />
                      </td>
                    </tr>
                  )
                }}
              </Index>
            </tbody>
          </table>
          <datalist id="cad-materials">
            <option value="HDPE" />
            <option value="PVC" />
            <option value="DuctileIron">Gang dẻo</option>
            <option value="Steel">Thép</option>
            <option value="CastIron">Gang xám</option>
            <option value="Concrete">Bê tông</option>
          </datalist>
        </div>
        <fieldset disabled={w.locked()} class="grid gap-3 border-t border-line p-4 md:grid-cols-3">
          <For
            each={
              [
                ['snapToleranceM', 'Ngưỡng nối đầu mút (m)'],
                ['simplifyToleranceM', 'Ngưỡng giản lược (m)'],
                ['minLengthM', 'Chiều dài tối thiểu (m)'],
              ] as const
            }
          >
            {([key, label]) => (
              <label class="flex flex-col gap-1.5 text-xs">
                {label}
                <input
                  class={field}
                  type="number"
                  min="0"
                  step="0.01"
                  value={w.config()?.[key] ?? 0}
                  onInput={event =>
                    w.edit(config => ({
                      ...config,
                      [key]:
                        event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value),
                    }))
                  }
                />
              </label>
            )}
          </For>
        </fieldset>
        <p class="border-t border-line px-4 py-3 text-[11px] leading-5 text-[color:var(--muted)]">
          Tự động loại đường dài bằng 0 và gộp tuyến trùng hoàn toàn cùng thuộc tính. Các ngưỡng
          dưới đây chỉ có hiệu lực sau khi Lưu bản nháp. Ngưỡng tính theo mét sau khi xác nhận tọa
          độ. Tăng ngưỡng nối có thể thay đổi đấu nối; ngưỡng giản lược 0 giữ nguyên hình học. Mỗi
          lần áp dụng tạo lại kết quả từ tệp gốc.
        </p>
      </Card>
    </>
  )
  const BlocksPanel = () => (
    <>
      <BlockMapping
        workspace={w}
        fileFilter={fileFilter()}
        onLocate={(id, ids) => {
          editor.cancel()
          setFileFilter('')
          setLayerFilter('')
          setFeatureSearch('')
          setSelectedId(id)
          setHighlightedIds(ids)
          setFocusKey(value => value + 1)
        }}
        onSelect={id => {
          w.setView('raw')
          setSelectedId(id)
          setFeatureSearch(id)
          setPanel('object')
          setFocusKey(value => value + 1)
        }}
      />
    </>
  )
  const InspectorPanel = () => (
    <>
      <div class="grid gap-3 p-4">
        <div class="flex flex-col gap-2">
          <label class="text-xs">
            Tìm đối tượng đã tải
            <input
              class={`${field} mt-1`}
              value={featureSearch()}
              onInput={event => setFeatureSearch(event.currentTarget.value)}
              placeholder="Mã, lớp hoặc nội dung chú dẫn"
            />
          </label>
          <label class="text-xs">
            Chọn đối tượng
            <select
              class={`${field} mt-1`}
              value={selectedId()}
              onChange={event => {
                selectFeature(event.currentTarget.value)
                setFocusKey(value => value + 1)
              }}
            >
              <option value="">Chọn trên bản vẽ hoặc trong danh sách</option>
              <For each={listedFeatures().slice(0, 200)}>
                {feature => (
                  <option value={feature.id}>
                    {feature.properties.layer} · {feature.id}
                  </option>
                )}
              </For>
            </select>
          </label>
          <p class="text-[11px] text-[color:var(--muted)]">
            Danh sách hiển thị tối đa 200 kết quả; tìm mã hoặc tên lớp để thu hẹp.
          </p>
        </div>
        <div class="rounded-lg border border-line p-3">
          <Show
            when={selectedFeature()}
            fallback={
              <p class="text-xs leading-6 text-[color:var(--muted)]">
                Chọn một đối tượng để xem nguồn và loại đường dư. Có thể khôi phục mọi quyết định
                loại thủ công trước khi gửi bản nháp.
              </p>
            }
          >
            {feature => (
              <div class="flex flex-col gap-2 text-xs">
                <b class="break-all">{feature().id}</b>
                <div>
                  Lớp: {feature().properties.layer} · {feature().properties.entityType}
                </div>
                <div class="break-words">{fileNames().get(feature().properties.fileId ?? '')}</div>
                <Show when={feature().properties.text}>
                  <div class="break-words">Chú dẫn: {feature().properties.text}</div>
                </Show>
                <Show when={feature().properties.reason}>
                  <div>Lý do: {feature().properties.reason}</div>
                </Show>
                <Show when={selectedRule()}>
                  {rule => (
                    <fieldset disabled={w.locked()} class="grid gap-2 border-y border-line py-3">
                      <legend class="text-xs font-semibold">Thuộc tính lớp {rule().layer}</legend>
                      <p class="text-[11px] text-[color:var(--muted)]">
                        Thay đổi này áp dụng cho các đối tượng cùng lớp trong tệp.
                      </p>
                      <label>
                        Phân loại
                        <select
                          class={field}
                          aria-label="Phân loại lớp đang chọn"
                          value={rule().action}
                          onChange={event =>
                            updateRule(layerKey(rule()), {
                              action: event.currentTarget.value as LayerRule['action'],
                            })
                          }
                        >
                          <For each={Object.entries(actionLabels)}>
                            {([value, label]) => <option value={value}>{label}</option>}
                          </For>
                        </select>
                      </label>
                      <Show when={rule().action === 'pipe'}>
                        <div class="grid grid-cols-2 gap-2">
                          <label>
                            DN (mm)
                            <input
                              class={field}
                              aria-label="DN lớp đang chọn"
                              type="number"
                              min="0.01"
                              step="any"
                              value={rule().diameterMm ?? ''}
                              onInput={event =>
                                updateRule(layerKey(rule()), {
                                  diameterMm:
                                    event.currentTarget.value === ''
                                      ? undefined
                                      : Number(event.currentTarget.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Vật liệu
                            <input
                              class={field}
                              aria-label="Vật liệu lớp đang chọn"
                              placeholder="Chưa rõ"
                              value={rule().material ?? ''}
                              onInput={event =>
                                updateRule(layerKey(rule()), {
                                  material: event.currentTarget.value || undefined,
                                })
                              }
                            />
                          </label>
                        </div>
                      </Show>
                    </fieldset>
                  )}
                </Show>
                <button
                  type="button"
                  class={button}
                  disabled={w.locked() || w.view() !== 'raw'}
                  onClick={() => toggleExclude(feature().id)}
                >
                  {w.view() !== 'raw'
                    ? 'Chọn bản vẽ gốc để loại đối tượng'
                    : w.config()?.excludeFeatureIds.includes(feature().id)
                      ? 'Khôi phục đối tượng'
                      : 'Loại đối tượng này khỏi mạng'}
                </button>
              </div>
            )}
          </Show>
        </div>
      </div>
      <Show when={w.config()?.excludeFeatureIds.length}>
        <details class="border-t border-line p-4 text-xs">
          <summary class="cursor-pointer">
            Đã loại thủ công {w.config()?.excludeFeatureIds.length} đối tượng · có thể khôi phục
          </summary>
          <ul class="mt-3 max-h-[200px] space-y-2 overflow-y-auto">
            <For each={w.config()?.excludeFeatureIds}>
              {id => (
                <li class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 break-all font-mono text-[11px]">{id}</span>
                  <button
                    type="button"
                    class={button}
                    disabled={w.locked()}
                    onClick={() => toggleExclude(id)}
                  >
                    Khôi phục
                  </button>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
    </>
  )
  const QualityPanel = () => (
    <>
      <Card>
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-semibold">Chất lượng và quy trình duyệt</h2>
          <button
            type="button"
            class={button}
            disabled={w.busy()}
            onClick={() => void w.downloadReport()}
          >
            Tải báo cáo JSON
          </button>
        </div>
        <Show when={job().summary}>
          {summary => (
            <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-2">
              <For
                each={
                  [
                    ['Đối tượng nguồn', summary().rawFeatures],
                    ['Tuyến giữ lại', summary().keptPipes],
                    ['Đã loại', summary().excluded],
                    ['Trùng lặp', summary().duplicates],
                    ['Nút mạng', summary().nodes],
                    ['Tổng chiều dài (m)', summary().totalLengthM],
                    ['Lỗi chặn', summary().errors],
                    ['Cảnh báo', summary().warnings],
                  ] as [string, number][]
                }
              >
                {([label, value]) => (
                  <div class="rounded-lg border border-line p-3">
                    <div class="font-mono text-lg font-semibold">{number(value)}</div>
                    <div class="text-[11px] text-[color:var(--muted)]">{label}</div>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
        <div class="mb-3 space-y-2 text-xs">
          <p>Lọc lỗi, bấm Định vị đối tượng để xem và sửa; lưu bản nháp để kiểm tra lại.</p>
          <select
            class={field}
            aria-label="Mức độ vấn đề"
            value={issueSeverity()}
            onChange={e => setIssueSeverity(e.currentTarget.value)}
          >
            <option value="all">Tất cả mức độ</option>
            <option value="error">Lỗi chặn</option>
            <option value="warning">Cảnh báo</option>
            <option value="info">Thông tin</option>
          </select>
          <select
            class={field}
            aria-label="Nhóm vấn đề"
            value={issueCode()}
            onChange={e => setIssueCode(e.currentTarget.value)}
          >
            <option value="">Tất cả nhóm lỗi</option>
            <For each={issueCodes()}>
              {code => (
                <option value={code}>
                  {code} ({issues().filter(issue => issue.code === code).length})
                </option>
              )}
            </For>
          </select>
          <input
            class={field}
            aria-label="Tìm vấn đề"
            placeholder="Tìm mã, nội dung hoặc đối tượng…"
            value={issueSearch()}
            onInput={e => setIssueSearch(e.currentTarget.value)}
          />
          <p role="status">
            {number(filteredIssues().length)} vấn đề phù hợp · Trang {issuePage() + 1}/
            {Math.max(1, Math.ceil(filteredIssues().length / 50))}
          </p>
          <button
            class={button}
            disabled={issuePage() === 0}
            onClick={() => setIssuePage(p => p - 1)}
          >
            Trang trước
          </button>
          <button
            class={button}
            disabled={(issuePage() + 1) * 50 >= filteredIssues().length}
            onClick={() => setIssuePage(p => p + 1)}
          >
            Trang sau
          </button>
          <button class={button} onClick={() => setPanel('layers')}>
            Sửa thuộc tính và làm sạch
          </button>
        </div>
        <Show
          when={filteredIssues().length}
          fallback={<p class="p-3 text-xs">Không có vấn đề phù hợp bộ lọc.</p>}
        >
          <div class="mb-3 max-h-[260px] overflow-y-auto rounded-lg border border-line">
            <For each={filteredIssues().slice(issuePage() * 50, (issuePage() + 1) * 50)}>
              {issue => (
                <div class="border-b border-line p-3 text-xs">
                  <div class="flex items-center gap-2">
                    <Badge
                      soft
                      color={
                        issue.severity === 'error'
                          ? '#b91c1c'
                          : issue.severity === 'warning'
                            ? '#a16207'
                            : undefined
                      }
                    >
                      {issue.severity === 'error'
                        ? 'Lỗi'
                        : issue.severity === 'warning'
                          ? 'Cảnh báo'
                          : 'Thông tin'}
                    </Badge>
                    <code class="break-all text-[10px]">{issue.code}</code>
                  </div>
                  <p class="mt-1.5 leading-5">{issue.message}</p>
                  <Show when={issueHelp(issue.code)}>
                    <p class="mt-2 text-[color:var(--muted)]">
                      Cách xử lý: {issueHelp(issue.code)}
                    </p>
                  </Show>
                  <Show when={issue.featureId}>
                    <button
                      type="button"
                      class="mt-1 break-all text-left text-sky-700 underline"
                      onClick={() => {
                        locateIssue(issue)
                      }}
                    >
                      Định vị đối tượng: {issue.featureId}
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={warningGroups().length}>
          <fieldset disabled={w.locked()} class="mb-4 space-y-2">
            <legend class="mb-2 text-xs font-semibold">
              Xác nhận từng nhóm cảnh báo sau khi rà soát
            </legend>
            <For each={warningGroups()}>
              {warning => (
                <label class="flex items-start gap-2 rounded-lg bg-[var(--surface2)] p-2.5 text-xs leading-5">
                  <input
                    type="checkbox"
                    class="mt-1"
                    checked={w.config()?.acceptWarningCodes.includes(warning.code)}
                    onChange={() =>
                      w.edit(config => ({
                        ...config,
                        acceptWarningCodes: config.acceptWarningCodes.includes(warning.code)
                          ? config.acceptWarningCodes.filter(code => code !== warning.code)
                          : [...config.acceptWarningCodes, warning.code],
                      }))
                    }
                  />
                  <span>
                    {warning.code} · {warning.count} trường hợp
                    <br />
                    {warning.message}
                  </span>
                </label>
              )}
            </For>
          </fieldset>
        </Show>
        <Show when={['RetryRequired', 'Draft'].includes(job().submission?.status ?? '')}>
          <button
            type="button"
            class={button}
            disabled={w.busy() || !props.canSubmit}
            onClick={() =>
              void w.mutate(client => client.submit(job().id, job().version, job().name))
            }
          >
            Thử lại gửi duyệt
          </button>
        </Show>
        <Show when={!props.canSubmit}>
          <p class="mt-3 text-xs text-amber-700">
            Gửi duyệt cần quyền đọc / ghi thiết kế và đọc GIS (network-design:read,
            network-design:write, network-gis:read).
          </p>
        </Show>
        <p class="mt-3 text-xs leading-5 text-[color:var(--muted)]">
          Cần xử lý hết lỗi chặn, xác nhận tọa độ và áp dụng thay đổi trước khi gửi duyệt. Kết quả
          tạo thành hồ sơ Design có nút mạng, tuyến ống và nguồn tham chiếu để đối soát.
        </p>
        <Show when={job().submission}>
          {submission => (
            <div class="mt-4 rounded-lg border border-line p-3 text-xs">
              <p class="font-semibold">
                Trạng thái Design: {submission().status ?? 'Đang cập nhật'}
              </p>
              <Show when={submission().message}>
                <p class="mt-1 leading-5">{submission().message}</p>
              </Show>
              <p class="mt-2 break-all font-mono text-[10px]">
                Dự án: {submission().projectId ?? '—'} · Phiên bản: {submission().revisionId ?? '—'}
              </p>
              <button
                type="button"
                class={`${button} mt-3`}
                disabled={w.busy()}
                onClick={() => void w.mutate(client => client.publishResult(job().id))}
              >
                Đối soát kết quả xuất bản
              </button>
              <Show
                when={
                  props.canApprove &&
                  job().state === 'submitted' &&
                  !['approved', 'published', 'imported', 'completed'].includes(
                    (submission().status ?? '').toLowerCase()
                  )
                }
              >
                <div class="mt-3 border-t border-line pt-3">
                  <label class="mb-3 flex flex-col gap-1.5">
                    Căn cứ hiện trạng để xuất bản
                    <textarea
                      class={field}
                      rows={2}
                      value={lifecycleEvidence() || job().reviewConfig?.lifecycleEvidence || ''}
                      onInput={event => setLifecycleEvidence(event.currentTarget.value)}
                      disabled={w.busy()}
                      placeholder="Nguồn xác nhận hồ sơ hoàn công / hiện trạng đã thi công"
                    />
                  </label>
                  <label class="flex flex-col gap-1.5">
                    Lý do phê duyệt và xuất bản
                    <textarea
                      class={field}
                      rows={2}
                      value={publishReason()}
                      onInput={event => setPublishReason(event.currentTarget.value)}
                      disabled={w.busy()}
                    />
                  </label>
                  <p class="my-2 leading-5 text-[color:var(--muted)]">
                    Thao tác phê duyệt bản nháp và đưa tài sản vào mạng GIS của đơn vị hiện tại. Cần
                    căn cứ hồ sơ hiện trạng đã lưu và quyền phê duyệt.
                  </p>
                  <Btn variant="primary" disabled={publishDisabled()} onClick={publish}>
                    Xuất bản sau duyệt
                  </Btn>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </Card>
    </>
  )
  return (
    <section
      class="import-map-review"
      aria-label="Không gian rà soát bản vẽ"
      onKeyDown={event => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'z' &&
          !(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')
        ) {
          event.preventDefault()
          editor.cancel()
          if (event.shiftKey) w.redo()
          else w.undo()
        }
        if (event.key === 'Escape') {
          cancelPointPicking()
          editor.cancel()
        }
      }}
    >
      <header class="import-review-header">
        <div class="min-w-0">
          <h2 class="truncate font-semibold">{job().name}</h2>
          <span class="text-[11px] text-[color:var(--muted)]">
            Phiên bản {job().version} · {job().files.length} bản vẽ ·{' '}
            {number(job().summary?.rawFeatures ?? 0)} đối tượng
          </span>
        </div>
        <Badge soft>{stateLabels[job().state]}</Badge>
        <button
          type="button"
          class={button}
          aria-pressed={panel() === 'align'}
          onClick={() => (panel() === 'align' ? closeAlignment() : openAlignment())}
        >
          {panel() === 'align' ? 'Về chỉnh sửa bản vẽ' : 'Căn vị trí trên GIS'}
        </button>
      </header>
      <div class="cad-workflow-bar">
        <span class="cad-step">1 · Chọn tệp / đối tượng</span>
        <button type="button" onClick={() => setPanel('quality')}>
          2 · Xử lý {number(job().summary?.errors ?? 0)} lỗi ·{' '}
          {number(job().summary?.warnings ?? 0)} cảnh báo
        </button>
        <span class="cad-step">3 · Lưu bản nháp để kiểm tra lại</span>
      </div>
      <Show when={activeIssue()}>
        {item => (
          <div class="cad-issue-focus" role="region" aria-label="Lỗi đang sửa">
            <div>
              <strong>{item().message}</strong>
              <p>
                {issueHelp(item().code) ??
                  'Chọn đối tượng để chỉnh sửa; lưu bản nháp để cập nhật kết quả kiểm tra.'}
              </p>
              <Show when={w.dirty()}>
                <small>Kết quả lỗi chưa cập nhật — cần lưu bản nháp.</small>
              </Show>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class={button} onClick={() => setPanel('quality')}>
                Danh sách lỗi
              </button>
              <button
                class={button}
                disabled={!filteredIssues().length}
                onClick={() => {
                  const list = filteredIssues()
                  const index = list.findIndex(
                    i => i.code === item().code && i.featureId === item().featureId
                  )
                  locateIssue(list[(index + 1) % list.length]!)
                }}
              >
                Lỗi tiếp theo
              </button>
              <button
                class={button}
                aria-label="Đóng lỗi đang sửa"
                onClick={() => setActiveIssue(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={isProcessing(job())}>
        <p role="status" class="import-notice">
          Đang xử lý hồ sơ. Kết quả sẽ tự cập nhật.
        </p>
      </Show>
      <Show when={job().error}>
        <p role="alert" class="import-error">
          {job().error}
        </p>
      </Show>
      <Show when={job().inventory && w.config()}>
        <div class="import-workbench" classList={{ 'import-workbench-align': panel() === 'align' }}>
          <section class="import-map-area" aria-label="Bản đồ CAD">
            <div class="import-canvas-card">
              <Show when={panel() !== 'align' && w.view() === 'raw'}>
                <editor.Toolbar />
              </Show>
              <div class="flex flex-wrap items-center gap-3 border-b border-line p-4">
                <h2 class="text-sm font-semibold">
                  {panel() === 'align' ? 'Bản CAD · tọa độ gốc' : 'Bản vẽ'}
                </h2>
                <div
                  class="ml-auto gap-1"
                  style={{ display: panel() === 'align' ? 'none' : 'flex' }}
                >
                  <For
                    each={
                      [
                        ['raw', 'Bản CAD đang sửa'],
                        ['clean', 'Mạng đã làm sạch'],
                      ] as const
                    }
                  >
                    {([view, label]) => (
                      <button
                        type="button"
                        class={button}
                        aria-pressed={w.view() === view}
                        onClick={() => {
                          editor.cancel()
                          w.setView(view)
                          setSelectedId('')
                        }}
                        style={{ background: w.view() === view ? 'var(--surface2)' : undefined }}
                      >
                        {label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <div class="flex flex-wrap items-end gap-3 border-b border-line p-3">
                <Show when={job().files.length > 1}>
                  <label class="min-w-[200px] flex-1 text-xs">
                    Bản vẽ hiển thị
                    <select
                      class={`${field} mt-1`}
                      value={fileFilter()}
                      onChange={event => {
                        setFileFilter(event.currentTarget.value)
                        setLayerFilter('')
                        setSelectedId('')
                        cancelPointPicking()
                      }}
                    >
                      <option value="">Tất cả bản vẽ</option>
                      <For each={job().files}>
                        {file => <option value={file.id}>{file.name}</option>}
                      </For>
                    </select>
                  </label>
                </Show>
                <label class="min-w-[200px] flex-1 text-xs">
                  Lớp hiển thị
                  <select
                    class={`${field} mt-1`}
                    value={layerFilter()}
                    onChange={event => {
                      setLayerFilter(event.currentTarget.value)
                      setSelectedId('')
                    }}
                  >
                    <option value="">Tất cả lớp trong tệp đã chọn</option>
                    <For each={layerOptions()}>
                      {layer => <option value={layer}>{layer}</option>}
                    </For>
                  </select>
                </label>
                <span class="pb-2 text-[11px] text-[color:var(--muted)]">
                  Đang hiển thị {number(features().length)} · đã tải{' '}
                  {number(activePreview()?.features.length ?? 0)} /{' '}
                  {number(activePreview()?.total ?? 0)} đối tượng của chế độ này
                </span>
              </div>
              <Show when={pickingCad()}>
                <p role="status" class="import-pick-notice">
                  Bấm vào vị trí rõ nét trên CAD. Kéo để di chuyển; Esc để thoát.
                </p>
              </Show>
              <Show when={w.dirty()}>
                <p class="border-b border-line bg-amber-50 px-4 py-2 text-xs text-amber-900">
                  Có quyết định chưa áp dụng. Hình học và thống kê máy chủ vẫn thuộc phiên bản{' '}
                  {job().version}; màu lớp và loại thủ công phản ánh lựa chọn hiện tại.
                </p>
              </Show>
              <Show when={w.previewError()}>
                <div role="alert" class="p-4 text-sm text-red-700">
                  {w.previewError()}{' '}
                  <button
                    type="button"
                    class="underline"
                    disabled={w.dirty()}
                    onClick={() => void w.select(job().id)}
                  >
                    Tải lại hồ sơ
                  </button>
                </div>
              </Show>
              <Show when={activePreview()}>
                {page => (
                  <CadPreview
                    features={features()}
                    selectedId={selectedId()}
                    highlightedIds={highlightedIds()}
                    onSelect={selectFeature}
                    controlPoints={(page().coordinateSpace === 'cad'
                      ? (w.config()?.controlPoints ?? [])
                      : []
                    ).flatMap((point, index) =>
                      point.source
                        ? [{ id: `cp-${index + 1}`, coordinate: point.source as [number, number] }]
                        : []
                    )}
                    activeControlPointId={
                      activePointIndex() === null ? undefined : `cp-${activePointIndex()! + 1}`
                    }
                    fill
                    focusKey={String(focusKey())}
                    pickPoint={
                      (pickingCad() && panel() === 'align') ||
                      (editor.active() && w.view() === 'raw' && panel() !== 'align')
                    }
                    sketch={editor.points()}
                    snapLines={editor.active()}
                    onCancelPick={() => editor.cancel()}
                    onPickPoint={point => {
                      if (editor.active() && panel() !== 'align' && w.view() === 'raw') {
                        editor.pick(point)
                        return
                      }
                      setPendingCadPoint(point)
                      setPickingCad(false)
                    }}
                    excludeFeatureIds={w.config()?.excludeFeatureIds ?? []}
                    layerRules={w.config()?.layerRules ?? []}
                    coordinateSpace={page().coordinateSpace}
                    resetKey={`${props.jobId}:${panel() === 'align' ? 'raw' : w.view()}:${fileFilter()}:${layerFilter()}`}
                  />
                )}
              </Show>
              <Show when={w.previewLoading()}>
                <p role="status" class="p-3 text-xs text-[color:var(--muted)]">
                  Đang tải bản xem trước…
                </p>
              </Show>
              <Show when={w.preview()?.hasMore}>
                <div class="flex flex-wrap items-center gap-3 border-t border-line p-3">
                  <button
                    type="button"
                    class={button}
                    disabled={
                      w.previewLoading() || (activePreview()?.features.length ?? 0) >= PREVIEW_LIMIT
                    }
                    onClick={() => void w.loadMore()}
                  >
                    Tải thêm 2.000 đối tượng
                  </button>
                  <p class="text-xs text-[color:var(--muted)]">
                    Giới hạn xem trước {number(PREVIEW_LIMIT)} đối tượng. Báo cáo chất lượng tính
                    trên toàn bộ hồ sơ.
                  </p>
                </div>
              </Show>
            </div>
          </section>
          <aside
            class="import-inspector"
            aria-label={
              panel() === 'align' ? 'Căn vị trí trên bản đồ GIS' : 'Thông tin và chỉnh sửa'
            }
          >
            <Show
              when={panel() === 'align'}
              fallback={
                <>
                  <nav class="import-panel-tabs" aria-label="Bảng công cụ">
                    <For
                      each={
                        [
                          ['object', 'Đối tượng'],
                          ['layers', 'Lớp dữ liệu'],
                          ['blocks', 'Ký hiệu'],
                          ['quality', 'Kiểm tra'],
                        ] as const
                      }
                    >
                      {([id, label]) => (
                        <button
                          type="button"
                          aria-pressed={panel() === id}
                          onClick={() => setPanel(id)}
                        >
                          {label}
                        </button>
                      )}
                    </For>
                  </nav>
                  <div class="import-panel-content">
                    <Show when={panel() === 'object'}>
                      <InspectorPanel />
                    </Show>
                    <Show when={panel() === 'layers'}>
                      <LayersPanel />
                    </Show>
                    <Show when={panel() === 'blocks'}>
                      <BlocksPanel />
                    </Show>
                    <Show when={panel() === 'quality'}>
                      <QualityPanel />
                      <details class="p-4 text-xs">
                        <summary>Tọa độ có sẵn và hồ sơ</summary>
                        <CoordinatesPanel />
                      </details>
                      <details class="p-4 text-xs">
                        <summary>Tệp nguồn và dấu vết dữ liệu</summary>
                        <For each={job().files}>
                          {file => (
                            <p class="mt-2 break-all">
                              {file.name}
                              <br />
                              <span class="text-[10px] text-[color:var(--muted)]">
                                SHA-256: {file.sha256}
                              </span>
                            </p>
                          )}
                        </For>
                      </details>
                    </Show>
                  </div>
                </>
              }
            >
              <GeoreferenceWorkbench
                workspace={w}
                pendingCadPoint={pendingCadPoint()}
                cancelPickToken={cancelPickToken()}
                onCancelCadPoint={() => {
                  setPickingCad(false)
                  setPendingCadPoint(null)
                }}
                onRequestCadPoint={() => {
                  setPickingCad(true)
                  if (!w.rawPreview()) w.setView('raw')
                }}
                onClearCadPoint={() => setPendingCadPoint(null)}
                onActiveControlPointChange={setActivePointIndex}
                features={features()}
                fileId={fileFilter() || undefined}
                geographicFeatures={
                  w.preview()?.coordinateSpace === 'EPSG:4326' ? w.preview()?.features : undefined
                }
              />
            </Show>
          </aside>
        </div>
        <p class="px-1 text-xs text-[color:var(--muted)]">
          Bản nháp được lưu dù còn lỗi và có thể mở lại từ Hồ sơ bản vẽ để sửa tiếp. Chỉ chuyển sang
          Ready khi hết lỗi và đã xác nhận các cảnh báo; sau đó mới gửi duyệt.
        </p>
        <footer class="import-review-footer">
          <span class="text-xs text-[color:var(--muted)]">
            {w.dirty() ? 'Có thay đổi chưa lưu vào bản nháp' : 'Hồ sơ đã lưu trên máy chủ'} ·{' '}
            {number(job().summary?.errors ?? 0)} mục cần xác nhận
          </span>
          <div class="flex flex-wrap gap-2">
            <Btn
              variant="primary"
              onClick={() => void w.save()}
              disabled={w.locked() || editor.active()}
            >
              Lưu bản nháp
            </Btn>
            <button
              type="button"
              class={button}
              disabled={w.busy() || !w.dirty()}
              onClick={() => void w.select(job().id)}
            >
              Bỏ thay đổi chưa lưu
            </button>
            <Btn
              onClick={submit}
              disabled={w.busy() || !props.canSubmit || !canSubmitJob(job(), w.dirty())}
            >
              Gửi duyệt bản Ready
            </Btn>
          </div>
        </footer>
      </Show>
    </section>
  )
}
