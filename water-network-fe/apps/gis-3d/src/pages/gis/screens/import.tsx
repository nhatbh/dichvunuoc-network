import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js'
import { useSession } from '@/entities/session/api/use-session'
import { stateLabels, type ImportJob } from '../import-workspace/types'
import { importSessionScope } from '../import-workspace/api'
import { ImportReview } from '../import-workspace/review'
import { importButton, importField, importNumber } from '../import-workspace/ui'
import { createImportWorkspace } from '../import-workspace/workspace'
import { Badge, Btn } from '../ui/kit'
import '../import-workspace/import-map.css'
import type { Branch } from '../lib/branch-store'
import type { Route } from '../shell/nav'

/** Durable CAD workspace; source files and review decisions belong to the authenticated tenant. */
export function ImportScreen(_props: {
  editorMode?: boolean
  draftMap?: boolean
  toast?: (message: string, kind?: string) => void
  go?: (route: Route) => void
  branchId?: string
  branches?: Branch[]
  setBranches?: (fn: (branches: Branch[]) => Branch[]) => void
}): JSX.Element {
  const session = useSession()
  const scope = createMemo(() => importSessionScope(session.data()))
  const workspace = createImportWorkspace(scope)
  const [files, setFiles] = createSignal<File[]>([])
  const [name, setName] = createSignal('')
  const [uploadMode, setUploadMode] = createSignal<'new' | 'append'>('new')
  const [showUpload, setShowUpload] = createSignal(false)
  const hasSavedFiles = (job: ImportJob) =>
    job.files.some(file => !job.reviewConfig?.excludedFileIds?.includes(file.id))
  const activeJobs = () => workspace.jobs().filter(hasSavedFiles)
  const emptyJobs = () => workspace.jobs().filter(job => !hasSavedFiles(job))
  const hasActiveFiles = () =>
    workspace.job()?.files.some(file => !workspace.config()?.excludedFileIds?.includes(file.id)) ??
    false
  const removed = (id: string) => workspace.config()?.excludedFileIds?.includes(id) ?? false
  const toggleFile = (id: string) =>
    workspace.edit(config => ({
      ...config,
      excludedFileIds: removed(id)
        ? (config.excludedFileIds ?? []).filter(x => x !== id)
        : [...(config.excludedFileIds ?? []), id],
      acceptWarningCodes: [],
    }))
  let fileInput: HTMLInputElement | undefined
  createEffect(
    on(scope, () => {
      setFiles([])
      setName('')
      setShowUpload(false)
      setUploadMode('new')
      if (fileInput) fileInput.value = ''
    })
  )
  async function upload() {
    const caps = workspace.capabilities()
    const chosen = files()
    if (!caps || !chosen.length || workspace.dirty()) return
    const current = workspace.job()
    if (uploadMode() === 'append' && (!current || workspace.locked())) return
    if (
      chosen.length + (uploadMode() === 'append' ? (current?.files.length ?? 0) : 0) >
      caps.maxFiles
    ) {
      workspace.setError(`Mỗi hồ sơ nhận tối đa ${caps.maxFiles} tệp.`)
      return
    }
    const invalid = chosen.find(
      file =>
        !/\.(dwg|dxf)$/i.test(file.name) ||
        !caps.formats.includes(file.name.split('.').pop()!.toLowerCase())
    )
    if (invalid) {
      workspace.setError(`Định dạng không được hỗ trợ: ${invalid.name}`)
      return
    }
    const tooLarge = chosen.find(file => file.size > caps.maxFileBytes || file.size === 0)
    if (tooLarge) {
      workspace.setError(
        `Tệp rỗng hoặc vượt ${importNumber(caps.maxFileBytes / 1024 / 1024)} MB: ${tooLarge.name}`
      )
      return
    }
    if (!caps.dwgAvailable && chosen.some(file => /\.dwg$/i.test(file.name))) {
      workspace.setError(
        'Máy chủ chưa có bộ chuyển đổi DWG. Có thể nạp DXF hoặc cấu hình bộ chuyển đổi để nhận DWG.'
      )
      return
    }
    await workspace.mutate(client =>
      uploadMode() === 'append' && current
        ? client.addFiles(current.id, current.version, chosen)
        : client.upload(
            name().trim() ||
              chosen
                .map(file => file.name)
                .join(' + ')
                .slice(0, 160),
            chosen
          )
    )
    if (!workspace.error()) {
      setFiles([])
      setName('')
      setShowUpload(false)
      if (fileInput) fileInput.value = ''
    }
  }
  return (
    <main class="import-map-screen" data-screen-label="Import CAD lên GIS">
      <header class="import-screen-header">
        <div>
          <h1>
            {_props.editorMode
              ? 'Biên tập mạng lưới · Bản nháp'
              : _props.draftMap
                ? 'Bản đồ bản nháp'
                : 'Import CAD lên GIS'}
          </h1>
          <p>
            {_props.draftMap
              ? 'Chọn hồ sơ để xem và sửa bản nháp. Dữ liệu chưa được xuất bản vào mạng vận hành.'
              : 'Chọn trên bản vẽ · căn vị trí trên bản đồ · chỉnh sửa dần'}
          </p>
        </div>
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <Badge soft>
            {session.data()?.user.organizationAlias ??
              session.data()?.user.tenantId ??
              'Chưa chọn đơn vị'}
          </Badge>
          <Show when={activeJobs().length && hasActiveFiles()}>
            <select
              class={`${importField} import-job-picker`}
              aria-label="Hồ sơ bản vẽ"
              disabled={workspace.busy() || workspace.dirty() || workspace.sketchActive()}
              value={workspace.job()?.id ?? ''}
              onChange={event => void workspace.select(event.currentTarget.value)}
            >
              <For each={activeJobs()}>
                {job => (
                  <option value={job.id}>
                    {job.name} — {stateLabels[job.state]}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => void workspace.refresh()}
            disabled={!scope() || workspace.loading() || workspace.busy()}
          >
            Tải lại
          </Btn>
        </div>
      </header>
      <Show when={!scope() && !session.isLoading()}>
        <div role="alert" class="import-notice">
          {session.data()?.user.tenantContextSource === 'legacy-tenant-id'
            ? 'Import DWG cần phiên đăng nhập theo đơn vị đã được cấu hình. Liên hệ quản trị để chọn đơn vị.'
            : 'Cần đăng nhập và chọn đơn vị để quản lý hồ sơ import.'}
        </div>
      </Show>
      <Show when={workspace.error()}>
        <div role="alert" class="import-error">
          {workspace.error()}
        </div>
      </Show>
      <Show when={workspace.job() && (hasActiveFiles() || workspace.dirty())}>
        <section class="cad-file-manager" aria-label="Quản lý tệp CAD">
          <header>
            <div>
              <h2>Tệp CAD trong hồ sơ</h2>
              <p>Quản lý các bản vẽ đang dùng. Tệp bị xóa được chuyển sang mục Tệp đã xóa.</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Show when={workspace.job()}>
                <button
                  class={importButton}
                  disabled={workspace.locked() || workspace.dirty() || workspace.sketchActive()}
                  onClick={() => {
                    setUploadMode('append')
                    setShowUpload(true)
                    setFiles([])
                  }}
                >
                  + Thêm CAD vào hồ sơ này
                </button>
              </Show>
              <button
                class={importButton}
                disabled={workspace.busy() || workspace.dirty() || workspace.sketchActive()}
                onClick={() => {
                  setUploadMode('new')
                  setShowUpload(true)
                  setFiles([])
                }}
              >
                Tạo hồ sơ mới
              </button>
            </div>
          </header>
          <Show when={workspace.job()}>
            {current => (
              <>
                <div class="cad-file-grid" aria-label="Tệp CAD đang dùng">
                  <For each={current().files.filter(file => !removed(file.id))}>
                    {file => (
                      <article class="cad-file-card">
                        <span class="cad-format">{file.format.toUpperCase()}</span>
                        <div class="min-w-0 flex-1">
                          <h3>{file.name}</h3>
                          <p>
                            {importNumber(file.bytes / 1024 / 1024)} MB · Đang dùng trong bản nháp
                          </p>
                        </div>
                        <button
                          class={importButton}
                          disabled={workspace.locked() || workspace.sketchActive()}
                          aria-label={`Xóa ${file.name}`}
                          onClick={() => toggleFile(file.id)}
                        >
                          Xóa tệp
                        </button>
                      </article>
                    )}
                  </For>
                </div>
                <Show when={!current().files.some(file => !removed(file.id))}>
                  <p class="cad-empty-files">
                    Chưa có tệp CAD đang dùng. Lưu thay đổi nếu có, rồi chọn “Thêm CAD vào hồ sơ
                    này” để nhập bản vẽ mới.
                  </p>
                </Show>
                <div class="cad-save-bar" role="status">
                  <span>
                    {current().submission
                      ? 'Hồ sơ đã gửi duyệt — không thể thay đổi tệp nguồn.'
                      : workspace.sketchActive()
                        ? 'Đang vẽ / chỉnh tuyến — hoàn tất hoặc hủy thao tác trước khi lưu hay xóa tệp.'
                        : workspace.busy() || ['queued', 'analyzing'].includes(current().state)
                          ? 'Đang lưu và phân tích…'
                          : workspace.dirty()
                            ? 'Có thay đổi chưa lưu — bấm Lưu bản nháp để áp dụng.'
                            : 'Đã lưu trên máy chủ. Bạn có thể thêm tệp mới hoặc xóa tệp đang dùng.'}
                  </span>
                  <Show when={workspace.dirty()}>
                    <button
                      class={importButton}
                      disabled={workspace.locked() || workspace.sketchActive()}
                      onClick={() => void workspace.save()}
                    >
                      Lưu thay đổi tệp và bản nháp
                    </button>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </section>
      </Show>
      <Show when={emptyJobs().length}>
        <details class="cad-trash">
          <summary>Hồ sơ không còn CAD ({emptyJobs().length})</summary>
          <div class="cad-trash-content">
            <p>
              Các hồ sơ này không còn bản vẽ đang dùng. Mở hồ sơ để xem mục Tệp đã xóa nếu cần khôi
              phục.
            </p>
            <For each={emptyJobs()}>
              {job => (
                <button
                  class={importButton}
                  disabled={workspace.busy() || workspace.dirty() || workspace.sketchActive()}
                  onClick={() => void workspace.select(job.id)}
                >
                  {job.name}
                </button>
              )}
            </For>
          </div>
        </details>
      </Show>
      <Show when={workspace.job()?.files.some(file => removed(file.id))}>
        <details class="cad-trash">
          <summary>
            Tệp đã xóa ({workspace.job()?.files.filter(file => removed(file.id)).length})
          </summary>
          <div class="cad-trash-content">
            <p>
              Tệp trong mục này không dùng trong bản nháp sau khi lưu. Khôi phục tại đây nếu cần
              dùng lại; thao tác này cũng cần lưu bản nháp.
            </p>
            <For each={workspace.job()?.files.filter(file => removed(file.id))}>
              {file => (
                <div class="cad-trash-row">
                  <span class="min-w-0 break-words">{file.name}</span>
                  <button
                    class={importButton}
                    disabled={workspace.locked() || workspace.sketchActive()}
                    aria-label={`Khôi phục ${file.name}`}
                    onClick={() => toggleFile(file.id)}
                  >
                    Khôi phục
                  </button>
                </div>
              )}
            </For>
          </div>
        </details>
      </Show>
      <Show
        when={showUpload() || !workspace.jobs().length || (!hasActiveFiles() && !workspace.dirty())}
      >
        <section class="import-upload" aria-label="Tải bản vẽ CAD">
          <form
            onSubmit={event => {
              event.preventDefault()
              void upload()
            }}
            class="flex flex-col gap-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-sm font-semibold">
                {uploadMode() === 'append' ? 'Thêm tệp vào hồ sơ đang mở' : '1. Tạo hồ sơ bản vẽ'}
              </h2>
              <span class="text-xs text-[color:var(--muted)]">
                Nhiều bản vẽ cùng mạng được đối soát trong một hồ sơ
              </span>
            </div>
            <fieldset
              disabled={!scope() || workspace.busy() || workspace.loading() || workspace.dirty()}
              class="grid min-w-0 gap-3 md:grid-cols-[1fr_1.5fr_auto] md:items-end"
            >
              <Show when={uploadMode() === 'new'}>
                <label class="flex min-w-0 flex-col gap-1.5 text-xs">
                  Tên hồ sơ
                  <input
                    class={importField}
                    value={name()}
                    onInput={event => setName(event.currentTarget.value)}
                    placeholder="Ví dụ: Vĩnh Thịnh · Đợt 3"
                    maxlength={160}
                  />
                </label>
              </Show>
              <label class="flex min-w-0 flex-col gap-1.5 text-xs">
                Bản vẽ DWG / DXF
                <input
                  ref={fileInput}
                  class={`${importField} file:mr-3 file:rounded file:border-0 file:bg-[var(--surface2)] file:px-3 file:py-1 file:text-xs`}
                  type="file"
                  multiple
                  accept=".dwg,.dxf"
                  onChange={event => {
                    setFiles(previous => [
                      ...previous,
                      ...Array.from(event.currentTarget.files ?? []).filter(
                        f =>
                          !previous.some(
                            p =>
                              p.name === f.name &&
                              p.size === f.size &&
                              p.lastModified === f.lastModified
                          )
                      ),
                    ])
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              <button
                type="submit"
                class={`${importButton} bg-[var(--surface2)]`}
                disabled={
                  !scope() ||
                  !workspace.capabilities() ||
                  workspace.busy() ||
                  workspace.loading() ||
                  !files().length
                }
              >
                {workspace.busy()
                  ? 'Đang xử lý…'
                  : uploadMode() === 'append'
                    ? 'Thêm tệp và phân tích'
                    : 'Tải lên và phân tích'}
              </button>
            </fieldset>
            <Show when={workspace.capabilities()}>
              {caps => (
                <p class="text-xs text-[color:var(--muted)]">
                  Tối đa {caps().maxFiles} tệp · {importNumber(caps().maxFileBytes / 1024 / 1024)}{' '}
                  MB/tệp.{' '}
                  {caps().dwgAvailable
                    ? 'Bộ đọc DWG sẵn sàng.'
                    : 'Hiện nhận DXF; bộ chuyển đổi DWG chưa sẵn sàng.'}{' '}
                  Nguồn gốc từng đối tượng và quyết định lọc được lưu trong hồ sơ.
                </p>
              )}
            </Show>
            <Show when={files().length}>
              <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--muted)]">
                <For each={files()}>
                  {file => (
                    <li>
                      {file.name} · {importNumber(file.size / 1024 / 1024)} MB{' '}
                      <button
                        type="button"
                        class={importButton}
                        aria-label={`Bỏ tệp đã chọn ${file.name}`}
                        onClick={() => setFiles(list => list.filter(item => item !== file))}
                      >
                        Bỏ chọn
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={workspace.jobs().length}>
              <button
                type="button"
                class={importButton}
                onClick={() => {
                  setFiles([])
                  setShowUpload(false)
                }}
              >
                Đóng phần tải lên
              </button>
            </Show>
          </form>
        </section>
      </Show>
      <Show when={workspace.loading()}>
        <p role="status" class="text-xs text-[color:var(--muted)]">
          Đang tải hồ sơ…
        </p>
      </Show>
      <Show when={!workspace.loading() && !workspace.jobs().length}>
        <p class="import-notice">
          Chưa có hồ sơ import của đơn vị hiện tại. Chọn các bản vẽ để bắt đầu.
        </p>
      </Show>
      <Show when={hasActiveFiles() ? workspace.job()?.id : undefined} keyed>
        {id => (
          <ImportReview
            draftMap={_props.draftMap}
            workspace={workspace}
            jobId={id}
            canSubmit={['network-design:write', 'network-design:read', 'network-gis:read'].every(
              permission => session.data()?.user.permissions?.includes(permission)
            )}
            canApprove={['network-design:approve', 'network-design:read'].every(permission =>
              session.data()?.user.permissions?.includes(permission)
            )}
          />
        )}
      </Show>
    </main>
  )
}
