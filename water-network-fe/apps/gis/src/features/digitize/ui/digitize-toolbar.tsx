import { useMutation, useQueryClient } from '@tanstack/solid-query'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  GitBranch,
  Info,
  Link2,
  Loader2,
  Pencil,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-solid'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import {
  connectNodeToPipe,
  createDraftFeature,
  splitPipe,
  updateDraftFeatureGeometry,
} from '@/entities/draft-feature'
import type { DraftFeatures } from '@/entities/draft-feature'
import { queryKeys } from '@/shared/api/query-keys'
import { isDesignEditorApi } from '@/shared/config/editor-api'
import { useMapRuntimeContext } from '@/shared/lib/map-runtime'
import { cn } from '@/shared/lib/utils'
import { createDigitizeStore, type DrawKind, type EditMode } from '../model/digitize-store'
import type { DrawGeometry } from '@wn/map-runtime'
import type { Geometry } from 'geojson'

const GEOM: Record<DrawKind, DrawGeometry> = { pipe: 'LineString', node: 'Point' }

type ToolGroup = 'create' | 'edit'
type FeedbackTone = 'info' | 'success' | 'error'

interface ToolDefinition {
  id: EditMode
  label: string
  compactLabel: string
  description: string
  shortcut: string
  group: ToolGroup
  icon: LucideIcon
}

const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'pipe',
    label: 'Vẽ đường ống',
    compactLabel: 'Đường ống',
    description: 'Nhấp từng đỉnh trên bản đồ, nhấp đúp tại điểm cuối để hoàn tất.',
    shortcut: 'L',
    group: 'create',
    icon: Waypoints,
  },
  {
    id: 'node',
    label: 'Thêm nút mạng',
    compactLabel: 'Nút mạng',
    description: 'Nhấp vị trí cần đặt nút; hệ thống sẽ lưu vào lớp bản nháp.',
    shortcut: 'N',
    group: 'create',
    icon: Circle,
  },
  {
    id: 'modify',
    label: 'Sửa hình học',
    compactLabel: 'Hình học',
    description: 'Chọn đối tượng trong bản nháp rồi kéo các đỉnh cần hiệu chỉnh.',
    shortcut: 'M',
    group: 'edit',
    icon: Pencil,
  },
  {
    id: 'split',
    label: 'Tách đường ống',
    compactLabel: 'Tách ống',
    description: 'Nhấp đúng vị trí cần tách trên một đường ống trong bản nháp.',
    shortcut: 'S',
    group: 'edit',
    icon: GitBranch,
  },
  {
    id: 'connect',
    label: 'Nối nút vào ống',
    compactLabel: 'Nối mạng',
    description: 'Bước 1/2: chọn nút cần nối. Sau đó chọn vị trí trên đường ống.',
    shortcut: 'C',
    group: 'edit',
    icon: Link2,
  },
] as const

const GROUP_LABELS: Record<ToolGroup, string> = {
  create: 'Tạo mới',
  edit: 'Hiệu chỉnh',
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Không thể lưu thay đổi. Kiểm tra kết nối và thử lại.'
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function DigitizeToolbar(props: { snapshotId: string }) {
  const { port } = useMapRuntimeContext()
  const qc = useQueryClient()
  const store = createDigitizeStore()
  const [feedback, setFeedback] = createSignal<{
    tone: FeedbackTone
    message: string
  } | null>(null)
  const toolSupported = (mode: EditMode) =>
    !isDesignEditorApi() || (mode !== 'split' && mode !== 'connect')

  const create = useMutation(() => ({
    mutationFn: (input: { kind: DrawKind; geometry: Geometry }) =>
      createDraftFeature(props.snapshotId, input),
    onMutate: () => setFeedback({ tone: 'info', message: 'Đang lưu đối tượng mới…' }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) })
      setFeedback({
        tone: 'success',
        message:
          input.kind === 'pipe' ? 'Đã thêm đường ống vào bản nháp.' : 'Đã thêm nút vào bản nháp.',
      })
      store.clear()
    },
    onError: error => setFeedback({ tone: 'error', message: errorMessage(error) }),
  }))

  const update = useMutation(() => ({
    mutationFn: (input: { featureId: string; geometry: Geometry }) =>
      updateDraftFeatureGeometry(props.snapshotId, input.featureId, { geometry: input.geometry }),
    onMutate: () => setFeedback({ tone: 'info', message: 'Đang lưu hình học…' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) })
      setFeedback({
        tone: 'success',
        message: 'Đã lưu hình học. Bạn có thể chọn đối tượng khác để tiếp tục.',
      })
      // Modify is deliberately a repeated operation.
    },
    onError: error => setFeedback({ tone: 'error', message: errorMessage(error) }),
  }))

  const split = useMutation(() => ({
    mutationFn: (input: { pipeId: string; atPoint: Geometry }) =>
      splitPipe(props.snapshotId, input.pipeId, { atPoint: input.atPoint }),
    onMutate: () => setFeedback({ tone: 'info', message: 'Đang tách đường ống…' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) })
      setFeedback({
        tone: 'success',
        message: 'Đã tách đường ống. Chọn vị trí khác để tiếp tục hoặc nhấn Esc để kết thúc.',
      })
      // Split is deliberately a repeated operation.
    },
    onError: error => setFeedback({ tone: 'error', message: errorMessage(error) }),
  }))

  const connect = useMutation(() => ({
    mutationFn: (input: { nodeId: string; pipeId: string; atPoint: Geometry }) =>
      connectNodeToPipe(props.snapshotId, input.pipeId, {
        nodeId: input.nodeId,
        atPoint: input.atPoint,
      }),
    onMutate: () => setFeedback({ tone: 'info', message: 'Đang cập nhật kết nối mạng…' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.draftFeatures.all(props.snapshotId) })
      store.setPendingConnectNodeId(null)
      setFeedback({
        tone: 'success',
        message: 'Đã nối nút vào đường ống. Chọn nút khác để tiếp tục.',
      })
    },
    onError: error => setFeedback({ tone: 'error', message: errorMessage(error) }),
  }))

  const busy = createMemo(
    () => create.isPending || update.isPending || split.isPending || connect.isPending
  )
  const activeTool = createMemo(() => TOOLS.find(tool => tool.id === store.mode()) ?? null)
  const instruction = createMemo(() => {
    if (store.mode() === 'connect' && store.pendingConnectNodeId()) {
      return `Bước 2/2: đã chọn ${store.pendingConnectNodeId()}. Nhấp vị trí kết nối trên đường ống.`
    }
    return (
      activeTool()?.description ??
      'Chọn một công cụ. Bạn luôn có thể nhấn Esc để quay về chế độ chọn.'
    )
  })

  const selectTool = (mode: EditMode) => {
    if (busy() || !toolSupported(mode)) return
    setFeedback(null)
    store.toggle(mode)
  }

  const cancel = () => {
    if (busy()) return
    store.clear()
    setFeedback(null)
  }

  // Drive draw, modify, and feature-point modes from one mutually-exclusive store.
  createEffect(() => {
    const p = port()
    if (!p) return
    const mode = store.mode()
    p.setDrawMode(mode === 'pipe' || mode === 'node' ? GEOM[mode] : null)
    p.setModifyMode(mode === 'modify')
    p.setFeaturePointMode(mode === 'split' || mode === 'connect')
  })

  // Create a draft feature when a geometry is drawn.
  createEffect(() => {
    const p = port()
    if (!p) return
    // eslint-disable-next-line solid/reactivity -- the map port invokes this as an event handler.
    const off = p.onDrawComplete((geometry: Geometry) => {
      const mode = store.mode()
      if ((mode === 'pipe' || mode === 'node') && !busy()) {
        create.mutate({ kind: mode, geometry })
      }
    })
    onCleanup(off)
  })

  // Persist geometry changes while keeping Modify active for repeated work.
  createEffect(() => {
    const p = port()
    if (!p) return
    // eslint-disable-next-line solid/reactivity -- the map port invokes this as an event handler.
    const off = p.onModifyComplete((featureId: string, geometry: Geometry) => {
      if (!busy()) update.mutate({ featureId, geometry })
    })
    onCleanup(off)
  })

  // Highlight the node awaiting a pipe pick only while Connect is active.
  createEffect(() => {
    const p = port()
    if (!p || store.mode() !== 'connect') return
    p.setSelection(store.pendingConnectNodeId())
  })

  // Split is one pick. Connect is a guided two-pick flow: node, then pipe.
  createEffect(() => {
    const p = port()
    if (!p) return
    // eslint-disable-next-line solid/reactivity -- the map port invokes this as an event handler.
    const off = p.onFeaturePointPick((featureId: string, point) => {
      if (busy()) return
      const at: Geometry = { type: 'Point', coordinates: [point.lon, point.lat] }
      const mode = store.mode()
      if (mode === 'split') {
        split.mutate({ pipeId: featureId, atPoint: at })
        return
      }
      if (mode !== 'connect') return

      const features = qc.getQueryData<DraftFeatures>(queryKeys.draftFeatures.all(props.snapshotId))
      const kind = features?.features.find(feature => feature.id === featureId)?.properties.kind
      if (kind === 'node') {
        store.setPendingConnectNodeId(featureId)
        setFeedback({
          tone: 'info',
          message: `Đã chọn nút ${featureId}. Bây giờ chọn vị trí trên đường ống.`,
        })
      } else if (kind === 'pipe') {
        const nodeId = store.pendingConnectNodeId()
        if (nodeId) {
          connect.mutate({ nodeId, pipeId: featureId, atPoint: at })
        } else {
          setFeedback({ tone: 'error', message: 'Hãy chọn một nút trước, sau đó chọn đường ống.' })
        }
      }
    })
    onCleanup(off)
  })

  // Keyboard access mirrors desktop GIS tools without taking over form fields.
  createEffect(() => {
    const shortcuts: Record<string, EditMode> = {
      l: 'pipe',
      n: 'node',
      m: 'modify',
      s: 'split',
      c: 'connect',
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'Escape' && store.mode()) {
        event.preventDefault()
        cancel()
        return
      }
      const mode = shortcuts[event.key.toLowerCase()]
      if (!mode || busy() || !toolSupported(mode)) return
      event.preventDefault()
      selectTool(mode)
    }
    window.addEventListener('keydown', handleKeydown)
    onCleanup(() => window.removeEventListener('keydown', handleKeydown))
  })

  const feedbackIcon = () => {
    if (busy()) return Loader2
    if (feedback()?.tone === 'success') return CheckCircle2
    if (feedback()?.tone === 'error') return AlertCircle
    return Info
  }

  return (
    <section
      data-testid="digitize-toolbar"
      data-mode={store.mode() ?? 'select'}
      aria-label="Công cụ biên tập mạng lưới"
      class="w-[min(980px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]/95 text-[color:var(--text)] shadow-[var(--toast-shadow)] backdrop-blur-md"
    >
      <div class="flex flex-wrap items-stretch gap-0 border-b border-[var(--line)]">
        <For each={['create', 'edit'] as const}>
          {group => (
            <div
              class={cn(
                'flex min-w-0 items-center gap-1.5 px-2.5 py-2',
                group === 'create' ? 'flex-[2]' : 'flex-[3] border-l border-[var(--line)]'
              )}
              role="group"
              aria-label={GROUP_LABELS[group]}
            >
              <span class="hidden shrink-0 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted2)] lg:block">
                {GROUP_LABELS[group]}
              </span>
              <For each={TOOLS.filter(tool => tool.group === group)}>
                {tool => {
                  const Icon = tool.icon
                  const active = () => store.mode() === tool.id
                  const supported = () => toolSupported(tool.id)
                  return (
                    <button
                      type="button"
                      data-testid={
                        tool.id === 'pipe'
                          ? 'draw-pipe'
                          : tool.id === 'node'
                            ? 'draw-node'
                            : `edit-${tool.id}`
                      }
                      aria-label={`${tool.label} (${tool.shortcut})${supported() ? '' : ' — chưa được BFF hỗ trợ'}`}
                      aria-pressed={active()}
                      disabled={busy() || !supported()}
                      title={
                        supported() ? tool.description : 'Design BFF dev chưa hỗ trợ thao tác này'
                      }
                      onClick={() => selectTool(tool.id)}
                      class={cn(
                        'group inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-transparent px-2 text-[12px] font-medium text-[color:var(--text2)] transition-colors',
                        'hover:bg-[var(--surface2)] hover:text-[color:var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-45',
                        active() &&
                          'border-[color:var(--focus)] bg-[var(--surface-active)] text-[color:var(--text)]'
                      )}
                    >
                      <Icon
                        class={cn(
                          'h-4 w-4 shrink-0 text-[color:var(--muted)] transition-colors',
                          active() && 'text-[color:var(--focus)]'
                        )}
                        aria-hidden="true"
                      />
                      <span class="truncate">{tool.compactLabel}</span>
                      <kbd class="hidden rounded border border-[var(--line)] bg-[var(--surface2)] px-1 py-0.5 font-mono text-[9px] font-medium text-[color:var(--muted2)] xl:inline">
                        {tool.shortcut}
                      </kbd>
                    </button>
                  )
                }}
              </For>
            </div>
          )}
        </For>
      </div>

      <div
        class="flex min-h-11 items-center gap-3 px-3 py-2"
        role="status"
        aria-live="polite"
        data-testid="digitize-guidance"
      >
        <Show
          when={feedback()}
          fallback={
            <>
              <span
                class={cn(
                  'h-2 w-2 shrink-0 rounded-full bg-[var(--muted2)]',
                  store.mode() && 'bg-[var(--focus)]'
                )}
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <div class="text-[11px] font-semibold text-[color:var(--text)]">
                  {activeTool()?.label ?? 'Sẵn sàng biên tập'}
                </div>
                <div class="truncate text-[10.5px] text-[color:var(--muted)]">{instruction()}</div>
              </div>
            </>
          }
        >
          {current => {
            const Icon = feedbackIcon()
            return (
              <>
                <Icon
                  class={cn(
                    'h-4 w-4 shrink-0',
                    busy() && 'animate-spin text-[color:var(--focus)]',
                    !busy() && current().tone === 'info' && 'text-[color:var(--focus)]',
                    current().tone === 'success' && 'text-emerald-600',
                    current().tone === 'error' && 'text-red-600'
                  )}
                  aria-hidden="true"
                />
                <p
                  class={cn(
                    'min-w-0 flex-1 text-[11px] font-medium text-[color:var(--text2)]',
                    current().tone === 'error' && 'text-red-700 dark:text-red-400'
                  )}
                >
                  {current().message}
                </p>
              </>
            )
          }}
        </Show>

        <Show when={store.mode()}>
          <button
            type="button"
            data-testid="draw-cancel"
            onClick={cancel}
            disabled={busy()}
            class="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 text-[11px] font-semibold text-[color:var(--text2)] transition-colors hover:bg-[var(--surface2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-wait disabled:opacity-55"
          >
            <X class="h-3.5 w-3.5" aria-hidden="true" />
            Kết thúc
            <kbd class="rounded bg-[var(--surface2)] px-1 py-0.5 font-mono text-[9px] text-[color:var(--muted2)]">
              Esc
            </kbd>
          </button>
        </Show>
      </div>
    </section>
  )
}
