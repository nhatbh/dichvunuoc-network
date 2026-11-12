import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js'
import {
  choiceFromConfig,
  choiceFromSuggestion,
  choicePatch,
  describeChoice,
  evidenceFor,
  jobSuggestion,
  presetFor,
  sameChoice,
  type CrsChoice,
  type Projection,
} from './crs-suggestion'
import { LocationMap } from './location-map'
import {
  acceptedMaterials,
  canSubmitJob,
  isProcessing,
  reviewForJob,
  stateLabels,
  type ImportJob,
  type LayerRule,
} from './types'
import { importNumber } from './ui'
import { jobNameFor, uploadProblem } from './upload'
import { vn2000Localities } from './vn2000-catalog'
import type { createImportWorkspace } from './workspace'
import type { FeatureCollection } from 'geojson'

type Workspace = ReturnType<typeof createImportWorkspace>
export type GuidedStep = 'upload' | 'location' | 'network' | 'submit'
export type AdvancedPanel = 'object' | 'layers' | 'blocks' | 'quality' | 'align'

const STEPS: Array<{ id: GuidedStep; label: string; hint: string }> = [
  { id: 'upload', label: 'Tải bản vẽ', hint: 'DWG / DXF' },
  { id: 'location', label: 'Vị trí', hint: 'Hệ tọa độ' },
  { id: 'network', label: 'Kiểm tra mạng', hint: 'Lớp, lỗi' },
  { id: 'submit', label: 'Gửi duyệt', hint: 'Design' },
]

const activeFiles = (job: ImportJob | null) =>
  job?.files.filter(file => !job.reviewConfig?.excludedFileIds?.includes(file.id)) ?? []

/** Saved and confirmed: a source CRS with evidence, or a valid point alignment. */
export function isLocated(job: ImportJob | null): boolean {
  const config = job?.reviewConfig
  if (!config?.crsEvidence?.trim()) return false
  if (config.controlPointTargetCrs === 'EPSG:4326') return job?.georeference?.status === 'valid'
  return !!config.sourceCrs?.trim()
}

export function currentStep(job: ImportJob | null): GuidedStep {
  if (!job || !activeFiles(job).length) return 'upload'
  if (!isLocated(job)) return 'location'
  if (job.state !== 'ready' && !job.submission) return 'network'
  return 'submit'
}

/**
 * The guided CAD import (decision 0032): one decision per step, the importer's proposals
 * filled in, and the advanced workspace one click away with the same job and settings.
 */
export function GuidedImport(props: {
  workspace: Workspace
  reviewer: string
  canSubmit: boolean
  canApprove: boolean
  openAdvanced: (panel?: AdvancedPanel) => void
}): JSX.Element {
  const w = props.workspace
  const [chosen, setChosen] = createSignal<GuidedStep | null>(null)
  createEffect(
    on(
      () => w.job()?.id,
      () => setChosen(null)
    )
  )
  const auto = createMemo(() => currentStep(w.job()))
  const step = () => chosen() ?? auto()
  const order = (id: GuidedStep) => STEPS.findIndex(s => s.id === id)
  const reachable = (id: GuidedStep) => id === 'upload' || order(id) <= order(auto())

  return (
    <section class="guided" aria-label="Nhập CAD theo từng bước">
      <ol class="guided-steps" aria-label="Các bước">
        <For each={STEPS}>
          {(item, index) => {
            const state = () =>
              item.id === step() ? 'current' : order(item.id) < order(auto()) ? 'done' : 'todo'
            return (
              <li data-state={state()}>
                <button
                  type="button"
                  disabled={!reachable(item.id) || w.busy()}
                  aria-current={item.id === step() ? 'step' : undefined}
                  onClick={() => setChosen(item.id === auto() ? null : item.id)}
                >
                  <span class="guided-step-number">{state() === 'done' ? '✓' : index() + 1}</span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                </button>
              </li>
            )
          }}
        </For>
      </ol>
      <Show when={w.job()?.state === 'failed'}>
        <div role="alert" class="guided-callout guided-callout-error">
          <strong>Không xử lý được bản vẽ.</strong> {w.job()?.error}
          <button type="button" class="guided-link" onClick={() => setChosen('upload')}>
            Tải lại bản vẽ khác
          </button>
        </div>
      </Show>
      <Show when={isProcessing(w.job())}>
        <div role="status" class="guided-callout guided-progress">
          <span class="guided-spinner" aria-hidden="true" />
          {w.job()?.state === 'submitting'
            ? 'Đang tạo hồ sơ thiết kế để gửi duyệt…'
            : 'Đang đọc và phân tích bản vẽ… thường mất dưới một phút.'}
        </div>
      </Show>
      <Show when={step() === 'upload'}>
        <UploadStep workspace={w} onCreated={() => setChosen(null)} />
      </Show>
      <Show when={step() === 'location' && w.job()}>
        <LocationStep
          workspace={w}
          reviewer={props.reviewer}
          openAdvanced={props.openAdvanced}
          onConfirmed={() => setChosen(null)}
        />
      </Show>
      <Show when={step() === 'network' && w.job()}>
        <NetworkStep workspace={w} openAdvanced={props.openAdvanced} />
      </Show>
      <Show when={step() === 'submit' && w.job()}>
        <SubmitStep
          workspace={w}
          canSubmit={props.canSubmit}
          canApprove={props.canApprove}
          openAdvanced={props.openAdvanced}
        />
      </Show>
    </section>
  )
}

// ------------------------------------------------------------------------------- 1. upload
function UploadStep(props: { workspace: Workspace; onCreated: () => void }): JSX.Element {
  const w = props.workspace
  const [files, setFiles] = createSignal<File[]>([])
  const [name, setName] = createSignal('')
  const [over, setOver] = createSignal(false)
  let input: HTMLInputElement | undefined
  const choose = (list: FileList | null | undefined) => {
    const next = [...(list ?? [])]
    if (!next.length) return
    setFiles(next)
    setName(jobNameFor(next))
    w.setError('')
  }
  async function start(mode: 'new' | 'append') {
    const caps = w.capabilities()
    const current = w.job()
    if (!caps || !files().length || w.dirty()) return
    const problem = uploadProblem(
      caps,
      files(),
      mode === 'append' ? (current?.files.length ?? 0) : 0
    )
    if (problem) {
      w.setError(problem)
      return
    }
    await w.mutate(client =>
      mode === 'append' && current
        ? client.addFiles(current.id, current.version, files())
        : client.upload(name().trim() || jobNameFor(files()), files())
    )
    if (!w.error()) {
      setFiles([])
      if (input) input.value = ''
      props.onCreated()
    }
  }
  return (
    <div class="guided-panel guided-upload">
      <label
        class="guided-drop"
        data-over={over() || undefined}
        onDragOver={event => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={event => {
          event.preventDefault()
          setOver(false)
          choose(event.dataTransfer?.files)
        }}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept=".dwg,.dxf"
          aria-label="Chọn bản vẽ DWG / DXF"
          disabled={w.busy()}
          onChange={event => choose(event.currentTarget.files)}
        />
        <span class="guided-drop-title">Kéo bản vẽ vào đây hoặc bấm để chọn</span>
        <span class="guided-drop-hint">
          DWG hoặc DXF, tối đa {w.capabilities()?.maxFiles ?? '…'} tệp
          {w.capabilities() && !w.capabilities()!.dwgAvailable
            ? ' · máy chủ hiện chỉ nhận DXF'
            : ''}
          . Hệ tọa độ được tự nhận từ bản vẽ ở bước sau.
        </span>
      </label>
      <Show when={files().length}>
        <ul class="guided-file-list">
          <For each={files()}>
            {file => (
              <li>
                <span>{file.name}</span>
                <small>{importNumber(file.size / 1024 / 1024)} MB</small>
              </li>
            )}
          </For>
        </ul>
        <label class="guided-field">
          Tên hồ sơ
          <input
            value={name()}
            maxLength={160}
            onInput={event => setName(event.currentTarget.value)}
            aria-label="Tên hồ sơ"
          />
        </label>
        <div class="guided-actions">
          <button
            type="button"
            class="guided-primary"
            disabled={w.busy() || !w.capabilities()}
            onClick={() => void start('new')}
          >
            Tạo hồ sơ và phân tích
          </button>
          <Show when={w.job() && !w.locked() && !w.job()?.submission}>
            <button
              type="button"
              class="guided-secondary"
              disabled={w.busy()}
              onClick={() => void start('append')}
            >
              Thêm vào hồ sơ “{w.job()?.name}”
            </button>
          </Show>
        </div>
      </Show>
      <Show when={w.job() && activeFiles(w.job()).length}>
        <p class="guided-note">
          Hồ sơ đang mở: <strong>{w.job()?.name}</strong> ({activeFiles(w.job()).length} tệp,{' '}
          {stateLabels[w.job()!.state]}). Chọn hồ sơ khác ở góc trên.
        </p>
      </Show>
    </div>
  )
}

// ----------------------------------------------------------------------------- 2. location
function LocationStep(props: {
  workspace: Workspace
  reviewer: string
  openAdvanced: (panel?: AdvancedPanel) => void
  onConfirmed: () => void
}): JSX.Element {
  const w = props.workspace
  const job = () => w.job()!
  const suggestion = createMemo(() => jobSuggestion(job(), w.config()?.excludedFileIds ?? []))
  const saved = createMemo(() =>
    job().reviewConfig?.sourceCrs?.trim() ? choiceFromConfig(job().reviewConfig!) : null
  )
  const pointAligned = () => !!job().reviewConfig?.controlPoints?.length
  const empty: CrsChoice = { localityId: '', projection: '', units: 'm', axisOrder: 'xy' }
  const initial = () => saved() ?? (suggestion()?.crs ? choiceFromSuggestion(suggestion()!) : empty)
  const [choice, setChoice] = createSignal<CrsChoice>(initial())
  const [editing, setEditing] = createSignal(false)
  createEffect(
    on(
      () => `${job().id}:${job().version}`,
      () => {
        if (w.dirty()) return
        setChoice(initial())
        setEditing(!saved() && !suggestion()?.crs)
      }
    )
  )
  createEffect(() => {
    if (saved() && w.view() !== 'clean') w.setView('clean')
  })
  const fromSuggestion = () => {
    const s = suggestion()
    return !!s?.crs && sameChoice(choice(), choiceFromSuggestion(s))
  }
  const footprint = createMemo(() => {
    const s = suggestion()
    if (!s) return null
    if (fromSuggestion()) return s.footprint ?? null
    const preset = presetFor(choice().localityId, choice().projection)
    const match = s.candidates.find(c => preset && c.presetId === preset.id)
    return choice().units === s.units && choice().axisOrder === s.axisOrder
      ? (match?.footprint ?? null)
      : null
  })
  const showingSaved = () => !!saved() && sameChoice(choice(), saved()!)
  const network = createMemo<FeatureCollection | null>(() => {
    const page = w.preview()
    if (
      !showingSaved() ||
      w.dirty() ||
      isProcessing(job()) ||
      page?.version !== job().version ||
      page.coordinateSpace !== 'EPSG:4326'
    )
      return null
    return {
      type: 'FeatureCollection',
      features: page.features.filter(f => !f.properties.isXref) as FeatureCollection['features'],
    }
  })
  const ready = () => !!presetFor(choice().localityId, choice().projection)
  const visible = () => !!footprint() || !!network()
  const confirmed = () => !!job().reviewConfig?.crsEvidence?.trim() && !!saved()

  async function apply(confirm: boolean) {
    const patch = choicePatch(choice())
    if (!patch || w.locked()) return
    w.edit(config => ({
      ...config,
      ...patch,
      crsEvidence: confirm ? evidenceFor(choice(), suggestion(), props.reviewer) : '',
    }))
    await w.save()
    if (!w.error()) {
      w.setView('clean')
      setEditing(false)
      if (confirm) props.onConfirmed()
    }
  }

  const status = () => {
    const s = suggestion()
    if (saved() && job().reviewConfig?.crsEvidence?.trim())
      return { tone: 'ok', title: 'Đã xác nhận vị trí' }
    if (!s || !s.crs) return { tone: 'warn', title: 'Chưa tự xác định được vị trí' }
    if (s.status === 'detected') return { tone: 'ok', title: 'Đã tự nhận vị trí từ bản vẽ' }
    return { tone: 'warn', title: 'Có đề xuất, cần kiểm tra' }
  }

  return (
    <div class="guided-location">
      <div class="guided-panel">
        <Show when={pointAligned()}>
          <div class="guided-callout">
            Hồ sơ này đang định vị bằng điểm khống chế. Chỉnh trong chế độ chuyên sâu, hoặc chọn hệ
            tọa độ bên dưới để thay thế.
            <button type="button" class="guided-link" onClick={() => props.openAdvanced('align')}>
              Mở căn bằng điểm khống chế
            </button>
          </div>
        </Show>
        <div class="guided-status" data-tone={status().tone}>
          <strong>{status().title}</strong>
          <span>
            {ready() ? describeChoice(choice()) : 'Chọn địa bàn và phép chiếu của hồ sơ.'}
          </span>
        </div>
        <Show when={suggestion()?.evidence.length}>
          <div class="guided-evidence">
            <h3>Căn cứ trong bản vẽ</h3>
            <ul>
              <For each={suggestion()!.evidence}>{item => <li>{item.text}</li>}</For>
              <For each={suggestion()!.checks.filter(c => !c.ok)}>
                {check => <li class="guided-evidence-warn">{check.message}</li>}
              </For>
            </ul>
          </div>
        </Show>
        <Show
          when={editing()}
          fallback={
            <button
              type="button"
              class="guided-link"
              disabled={w.locked()}
              onClick={() => setEditing(true)}
            >
              Chọn hệ tọa độ khác
            </button>
          }
        >
          <fieldset class="guided-form" disabled={w.locked()}>
            <legend>Hệ tọa độ của bản vẽ</legend>
            <Show when={(suggestion()?.candidates.length ?? 0) > 1}>
              <div class="guided-chips" aria-label="Địa danh tìm thấy trong bản vẽ">
                <For each={suggestion()!.candidates}>
                  {candidate => (
                    <button
                      type="button"
                      aria-pressed={
                        presetFor(choice().localityId, choice().projection)?.id ===
                        candidate.presetId
                      }
                      onClick={() =>
                        setChoice(c => ({
                          ...c,
                          localityId: candidate.presetId.split(':')[0]!,
                          projection: 'TM3',
                        }))
                      }
                    >
                      {candidate.label}
                      <small>
                        {candidate.consistent ? `${candidate.distanceKm} km` : 'xa bản vẽ'}
                      </small>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <label class="guided-field">
              Địa bàn (tỉnh trong hồ sơ)
              <select
                aria-label="Địa bàn VN-2000"
                value={choice().localityId}
                onChange={e => {
                  const localityId = e.currentTarget.value
                  setChoice(c => ({ ...c, localityId, projection: c.projection || 'TM3' }))
                }}
              >
                <option value="">Chọn địa bàn</option>
                <For each={vn2000Localities}>
                  {item => <option value={item.id}>{item.label}</option>}
                </For>
              </select>
            </label>
            <div class="guided-row">
              <label class="guided-field">
                Phép chiếu
                <select
                  aria-label="Phép chiếu VN-2000"
                  value={choice().projection}
                  onChange={e =>
                    setChoice(c => ({ ...c, projection: e.currentTarget.value as Projection | '' }))
                  }
                >
                  <option value="">Chọn</option>
                  <option value="TM3">TM-3 (địa phương)</option>
                  <option value="UTM48N">UTM múi 48</option>
                  <option value="UTM49N">UTM múi 49</option>
                </select>
              </label>
              <label class="guided-field">
                Đơn vị
                <select
                  aria-label="Đơn vị bản vẽ"
                  value={choice().units}
                  onChange={e =>
                    setChoice(c => ({ ...c, units: e.currentTarget.value as 'm' | 'mm' }))
                  }
                >
                  <option value="m">Mét</option>
                  <option value="mm">Milimét</option>
                </select>
              </label>
              <label class="guided-field">
                Trục
                <select
                  aria-label="Thứ tự trục"
                  value={choice().axisOrder}
                  onChange={e =>
                    setChoice(c => ({ ...c, axisOrder: e.currentTarget.value as 'xy' | 'yx' }))
                  }
                >
                  <option value="xy">X = Đông</option>
                  <option value="yx">X = Bắc</option>
                </select>
              </label>
            </div>
          </fieldset>
        </Show>
        <div class="guided-actions">
          <Show
            when={!(confirmed() && showingSaved())}
            fallback={
              <button type="button" class="guided-primary" onClick={() => props.onConfirmed()}>
                Tiếp tục
              </button>
            }
          >
            <Show
              when={visible()}
              fallback={
                <button
                  type="button"
                  class="guided-primary"
                  disabled={!ready() || w.locked()}
                  onClick={() => void apply(false)}
                >
                  Xem trên bản đồ
                </button>
              }
            >
              <button
                type="button"
                class="guided-primary"
                disabled={!ready() || w.locked()}
                onClick={() => void apply(true)}
              >
                Đúng vị trí, tiếp tục
              </button>
            </Show>
          </Show>
          <button
            type="button"
            class="guided-secondary"
            onClick={() => props.openAdvanced('align')}
          >
            Căn bằng điểm khống chế
          </button>
        </div>
        <p class="guided-note">
          Kiểm tra trên bản đồ: phạm vi bản vẽ (nét đứt) hoặc mạng lưới phải nằm đúng khu vực công
          trình. Lệch vài trăm mét thường do chọn sai địa bàn; lệch rất xa do sai đơn vị hoặc trục.
        </p>
      </div>
      <LocationMap footprint={footprint()} network={network()} />
    </div>
  )
}

// ------------------------------------------------------------------------------ 3. network
function NetworkStep(props: {
  workspace: Workspace
  openAdvanced: (panel?: AdvancedPanel) => void
}): JSX.Element {
  const w = props.workspace
  const job = () => w.job()!
  const stats = createMemo(() => {
    const map = new Map<string, { count: number; lineCount: number; textCount: number }>()
    for (const layer of job().inventory?.layers ?? [])
      map.set(JSON.stringify([layer.fileId, layer.name]), layer)
    return map
  })
  const key = (rule: Pick<LayerRule, 'fileId' | 'layer'>) =>
    JSON.stringify([rule.fileId, rule.layer])
  // Layers still unclassified in the saved job stay listed with the choice made, until applied.
  const pending = createMemo(() => {
    const open = new Set(
      reviewForJob(job())
        .layerRules.filter(rule => rule.action === 'review')
        .map(key)
    )
    return (w.config()?.layerRules ?? []).filter(rule => open.has(key(rule)))
  })
  const unresolved = () => pending().filter(rule => rule.action === 'review').length
  const describe = (rule: LayerRule) => {
    const s = stats().get(key(rule))
    if (!s) return ''
    const parts = [
      s.lineCount && `${importNumber(s.lineCount)} đường`,
      s.textCount && `${importNumber(s.textCount)} chữ`,
    ]
      .filter(Boolean)
      .join(', ')
    return `${importNumber(s.count)} đối tượng${parts ? ` (${parts})` : ''}`
  }
  const likelyText = (rule: LayerRule) => {
    const s = stats().get(key(rule))
    return !!s && s.textCount > s.lineCount
  }
  const reviewBlocks = createMemo(
    () => (w.config()?.blockRules ?? []).filter(rule => rule.action === 'review').length
  )
  const issues = () => job().issues ?? []
  const group = (severity: 'error' | 'warning') => {
    const groups = new Map<string, { message: string; count: number }>()
    for (const issue of issues().filter(i => i.severity === severity)) {
      const current = groups.get(issue.code)
      groups.set(issue.code, {
        message: current?.message ?? issue.message,
        count: (current?.count ?? 0) + 1,
      })
    }
    return [...groups].map(([code, detail]) => ({ code, ...detail }))
  }
  const errors = createMemo(() => group('error'))
  const warnings = createMemo(() => group('warning'))
  // A layer named only by a size ("50", "110") is the drawing's own DN; offered, editable.
  const dnFromName = (layer: string) => {
    const value = /^\s*(?:DN|D)?\s*(\d{2,4})\s*$/i.exec(layer)?.[1]
    return value && +value >= 15 && +value <= 2000 ? +value : undefined
  }
  const patchRule = (rule: LayerRule, change: Partial<LayerRule>) =>
    w.edit(config => ({
      ...config,
      layerRules: config.layerRules.map(r =>
        r.fileId === rule.fileId && r.layer === rule.layer ? { ...r, ...change } : r
      ),
    }))
  const setLayer = (rule: LayerRule, action: LayerRule['action']) =>
    patchRule(rule, {
      action,
      ...(action === 'pipe' && !rule.diameterMm && dnFromName(rule.layer)
        ? { diameterMm: dnFromName(rule.layer) }
        : {}),
    })
  // Pipe layers missing a size or material in the saved job (or just made pipes here).
  const attributeKeys = createMemo(() => {
    const saved = reviewForJob(job()).layerRules
    return new Set(
      saved
        .filter(
          r => r.action === 'review' || (r.action === 'pipe' && (!r.diameterMm || !r.material))
        )
        .map(key)
    )
  })
  const pipeLayers = createMemo(() =>
    (w.config()?.layerRules ?? []).filter(r => r.action === 'pipe' && attributeKeys().has(key(r)))
  )
  const missingAttributes = () => pipeLayers().filter(r => !r.diameterMm || !r.material).length
  const namedSizes = () => pipeLayers().filter(r => !r.diameterMm && dnFromName(r.layer)).length
  const fillNamedSizes = () =>
    w.edit(config => ({
      ...config,
      layerRules: config.layerRules.map(r =>
        r.action === 'pipe' && attributeKeys().has(key(r)) && !r.diameterMm && dnFromName(r.layer)
          ? { ...r, diameterMm: dnFromName(r.layer) }
          : r
      ),
    }))
  const setAllMaterial = (material: string) =>
    w.edit(config => ({
      ...config,
      layerRules: config.layerRules.map(r =>
        r.action === 'pipe' && attributeKeys().has(key(r)) && !r.material ? { ...r, material } : r
      ),
    }))
  const setAllPending = (action: LayerRule['action']) =>
    w.edit(config => ({
      ...config,
      layerRules: config.layerRules.map(r => (r.action === 'review' ? { ...r, action } : r)),
    }))
  const accepted = (code: string) => w.config()?.acceptWarningCodes.includes(code) ?? false
  const toggleWarning = (code: string) =>
    w.edit(config => ({
      ...config,
      acceptWarningCodes: config.acceptWarningCodes.includes(code)
        ? config.acceptWarningCodes.filter(c => c !== code)
        : [...config.acceptWarningCodes, code],
    }))
  const summary = () => job().summary

  return (
    <div class="guided-panel guided-network">
      <Show when={summary()}>
        {s => (
          <dl class="guided-tiles">
            <div>
              <dt>Tuyến ống</dt>
              <dd>{importNumber(s().keptPipes)}</dd>
            </div>
            <div>
              <dt>Chiều dài</dt>
              <dd>{importNumber(Math.round(s().totalLengthM))} m</dd>
            </div>
            <div>
              <dt>Nút mạng</dt>
              <dd>{importNumber(s().nodes)}</dd>
            </div>
            <div>
              <dt>Thiết bị</dt>
              <dd>{importNumber(s().devices)}</dd>
            </div>
            <div data-tone={s().errors ? 'bad' : 'ok'}>
              <dt>Lỗi chặn</dt>
              <dd>{importNumber(s().errors)}</dd>
            </div>
            <div data-tone={s().warnings ? 'warn' : 'ok'}>
              <dt>Cảnh báo</dt>
              <dd>{importNumber(s().warnings)}</dd>
            </div>
          </dl>
        )}
      </Show>

      <Show when={pending().length}>
        <section class="guided-block">
          <h3>
            Lớp chưa phân loại ({unresolved()} / {pending().length})
          </h3>
          <p class="guided-note">
            Chọn lớp nào là tuyến ống. Lớp chữ, kích thước, khung tên… để “Tham chiếu”.
          </p>
          <div class="guided-actions">
            <button
              type="button"
              class="guided-secondary"
              disabled={w.locked()}
              onClick={() => setAllPending('reference')}
            >
              Còn lại đều là tham chiếu
            </button>
          </div>
          <ul class="guided-layers">
            <For each={pending()}>
              {rule => {
                const option = (action: LayerRule['action'], label: string) => (
                  <button
                    type="button"
                    disabled={w.locked()}
                    aria-pressed={rule.action === action}
                    onClick={() => setLayer(rule, action)}
                  >
                    {label}
                  </button>
                )
                return (
                  <li data-done={rule.action !== 'review' || undefined}>
                    <span class="guided-layer-name">
                      {rule.layer}
                      <small>
                        {describe(rule)}
                        {likelyText(rule) && rule.action === 'review'
                          ? ' · có vẻ là chú thích'
                          : ''}
                      </small>
                    </span>
                    <span
                      class="guided-segment"
                      role="group"
                      aria-label={`Phân loại lớp ${rule.layer}`}
                    >
                      {option('pipe', 'Tuyến ống')}
                      {option('reference', 'Tham chiếu')}
                      {option('exclude', 'Bỏ qua')}
                    </span>
                  </li>
                )
              }}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={pipeLayers().length}>
        <section class="guided-block">
          <h3>Kích thước và vật liệu tuyến ống ({missingAttributes()} lớp còn thiếu)</h3>
          <p class="guided-note">
            Áp dụng cho các tuyến trong lớp chưa có ghi chú riêng. Lớp đặt tên theo cỡ ống (vd
            “110”) được điền sẵn đường kính.
          </p>
          <Show when={namedSizes()}>
            <div class="guided-actions">
              <button
                type="button"
                class="guided-secondary"
                disabled={w.locked()}
                onClick={fillNamedSizes}
              >
                Điền DN theo tên lớp ({namedSizes()} lớp)
              </button>
            </div>
          </Show>
          <label class="guided-field guided-inline">
            Vật liệu cho các lớp còn trống
            <select
              aria-label="Vật liệu cho các lớp còn trống"
              disabled={w.locked()}
              value=""
              onChange={e => e.currentTarget.value && setAllMaterial(e.currentTarget.value)}
            >
              <option value="">Chọn…</option>
              <For each={acceptedMaterials}>{m => <option value={m}>{m}</option>}</For>
            </select>
          </label>
          <ul class="guided-layers">
            <For each={pipeLayers()}>
              {rule => (
                <li data-done={(rule.diameterMm && rule.material) || undefined}>
                  <span class="guided-layer-name">
                    {rule.layer}
                    <small>{describe(rule)}</small>
                  </span>
                  <span class="guided-row">
                    <label class="guided-field guided-compact">
                      DN (mm)
                      <input
                        type="number"
                        min="15"
                        max="2000"
                        aria-label={`Đường kính lớp ${rule.layer}`}
                        disabled={w.locked()}
                        value={rule.diameterMm ?? ''}
                        onChange={e => {
                          const value = Number(e.currentTarget.value)
                          patchRule(rule, { diameterMm: value > 0 ? value : undefined })
                        }}
                      />
                    </label>
                    <label class="guided-field guided-compact">
                      Vật liệu
                      <select
                        aria-label={`Vật liệu lớp ${rule.layer}`}
                        disabled={w.locked()}
                        value={rule.material ?? ''}
                        onChange={e =>
                          patchRule(rule, { material: e.currentTarget.value || undefined })
                        }
                      >
                        <option value="">Chọn…</option>
                        <For each={acceptedMaterials}>{m => <option value={m}>{m}</option>}</For>
                      </select>
                    </label>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={reviewBlocks()}>
        <div class="guided-callout">
          {reviewBlocks()} loại ký hiệu (block) chưa gán thiết bị.
          <button type="button" class="guided-link" onClick={() => props.openAdvanced('blocks')}>
            Gán ký hiệu thiết bị
          </button>
        </div>
      </Show>

      <Show when={errors().length}>
        <section class="guided-block">
          <h3>Lỗi cần sửa trước khi gửi</h3>
          <ul class="guided-issues">
            <For each={errors()}>
              {issue => (
                <li data-tone="bad">
                  <span>
                    {issue.message}
                    <Show when={issue.count > 1}>
                      <small> · {issue.count} chỗ</small>
                    </Show>
                  </span>
                  <button
                    type="button"
                    class="guided-link"
                    onClick={() => props.openAdvanced('quality')}
                  >
                    Sửa
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={warnings().length}>
        <section class="guided-block">
          <h3>Cảnh báo — đánh dấu đã xem</h3>
          <ul class="guided-issues">
            <For each={warnings()}>
              {warning => (
                <li data-tone="warn">
                  <label>
                    <input
                      type="checkbox"
                      checked={accepted(warning.code)}
                      disabled={w.locked()}
                      onChange={() => toggleWarning(warning.code)}
                    />
                    <span>
                      {warning.message}
                      <Show when={warning.count > 1}>
                        <small> · {warning.count} chỗ</small>
                      </Show>
                    </span>
                  </label>
                  <button
                    type="button"
                    class="guided-link"
                    onClick={() => props.openAdvanced('quality')}
                  >
                    Xem
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <div class="guided-actions guided-sticky">
        <Show when={w.dirty()}>
          <button
            type="button"
            class="guided-primary"
            disabled={w.busy()}
            onClick={() => void w.save()}
          >
            Áp dụng và phân tích lại
          </button>
        </Show>
        <Show when={!w.dirty() && !isProcessing(job()) && job().state !== 'ready'}>
          <span class="guided-note">
            Sửa các mục trên rồi bấm Áp dụng; bước tiếp mở khi hết lỗi.
          </span>
        </Show>
        <button type="button" class="guided-secondary" onClick={() => props.openAdvanced('object')}>
          Xem và sửa trên bản vẽ
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------- 4. submit
function SubmitStep(props: {
  workspace: Workspace
  canSubmit: boolean
  canApprove: boolean
  openAdvanced: (panel?: AdvancedPanel) => void
}): JSX.Element {
  const w = props.workspace
  const job = () => w.job()!
  const config = () => job().reviewConfig
  const submit = () => {
    const current = job()
    if (props.canSubmit && canSubmitJob(current, w.dirty()))
      void w.mutate(client => client.submit(current.id, current.version, current.name))
  }
  return (
    <div class="guided-panel guided-submit">
      <Show
        when={job().submission}
        fallback={
          <>
            <h3>Sẵn sàng gửi duyệt</h3>
            <dl class="guided-kv">
              <dt>Hồ sơ</dt>
              <dd>{job().name}</dd>
              <dt>Vị trí</dt>
              <dd>
                {config()?.controlPointTargetCrs === 'EPSG:4326'
                  ? 'Căn bằng điểm khống chế'
                  : config()
                    ? describeChoice(choiceFromConfig(config()!))
                    : '—'}
              </dd>
              <dt>Mạng lưới</dt>
              <dd>
                {importNumber(job().summary?.keptPipes ?? 0)} tuyến ống ·{' '}
                {importNumber(Math.round(job().summary?.totalLengthM ?? 0))} m ·{' '}
                {importNumber(job().summary?.nodes ?? 0)} nút
              </dd>
            </dl>
            <p class="guided-note">
              Gửi duyệt tạo một hồ sơ thiết kế; mạng vận hành chỉ thay đổi sau khi người duyệt xuất
              bản.
            </p>
            <div class="guided-actions">
              <button
                type="button"
                class="guided-primary"
                disabled={w.busy() || !props.canSubmit || !canSubmitJob(job(), w.dirty())}
                onClick={submit}
              >
                Gửi duyệt
              </button>
            </div>
            <Show when={!props.canSubmit}>
              <p class="guided-note guided-evidence-warn">
                Tài khoản chưa có quyền gửi duyệt (network-design:write).
              </p>
            </Show>
          </>
        }
      >
        {submission => (
          <>
            <h3>Đã gửi duyệt</h3>
            <dl class="guided-kv">
              <dt>Trạng thái</dt>
              <dd>{submission().status ?? stateLabels[job().state]}</dd>
              <Show when={submission().message}>
                <dt>Ghi chú</dt>
                <dd>{submission().message}</dd>
              </Show>
            </dl>
            <div class="guided-actions">
              <Show when={['RetryRequired', 'Draft'].includes(submission().status ?? '')}>
                <button
                  type="button"
                  class="guided-primary"
                  disabled={w.busy() || !props.canSubmit}
                  onClick={() =>
                    void w.mutate(client => client.submit(job().id, job().version, job().name))
                  }
                >
                  Thử gửi lại
                </button>
              </Show>
              <Show when={props.canApprove}>
                <button
                  type="button"
                  class="guided-secondary"
                  onClick={() => props.openAdvanced('quality')}
                >
                  Duyệt và xuất bản
                </button>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
