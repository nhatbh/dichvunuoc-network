import { For, Show } from 'solid-js'
import type { Feature } from 'geojson'

interface AssetInspectorProps {
  feature: Feature | null
  onClose: () => void
  onEdit?: () => void
  onTrace?: () => void
}

// Properties that are internal and should not show in the KV list
const INTERNAL_KEYS = new Set(['kind', 'assetType', 'name', 'code', 'dma'])

const ASSET_TYPE_LABELS: Record<string, string> = {
  pipe: 'Tuyến ống',
  valve: 'Van',
  hydrant: 'Trụ cứu hoả',
  node: 'Nút / Phụ kiện',
  source: 'Thiết bị khác',
  dma: 'Ranh giới DMA',
  conn: 'Đấu nối',
}

export function AssetInspector(props: AssetInspectorProps) {
  return (
    <Show when={props.feature}>
      {feature => {
        const p = () => (feature().properties ?? {}) as Record<string, unknown>
        const name = () => (p().name as string) ?? String(feature().id)
        const code = () => (p().code as string) ?? ''
        const assetType = () => (p().assetType as string) ?? ''
        const dma = () => (p().dma as string | null) ?? null

        const kvEntries = () => Object.entries(p()).filter(([k]) => !INTERNAL_KEYS.has(k))

        return (
          <aside class="flex w-72 shrink-0 flex-col border-l border-border bg-background text-sm">
            {/* Header */}
            <div class="flex items-start gap-2 border-b border-border p-3">
              <div class="min-w-0 flex-1">
                <div class="truncate font-semibold text-foreground">{name()}</div>
                <div class="mt-0.5 text-xs text-muted-foreground">{code()}</div>
                <div class="mt-1 flex flex-wrap gap-1">
                  <Show when={assetType()}>
                    <span class="rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">
                      {ASSET_TYPE_LABELS[assetType()] ?? assetType()}
                    </span>
                  </Show>
                  <Show when={dma()}>
                    <span class="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                      {dma()}
                    </span>
                  </Show>
                </div>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                class="shrink-0 rounded p-1 hover:bg-accent"
                onClick={props.onClose}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* KV properties */}
            <div class="flex-1 overflow-y-auto p-3">
              <dl class="space-y-1.5">
                <For each={kvEntries()}>
                  {([k, v]) => (
                    <div class="flex gap-2">
                      <dt class="w-28 shrink-0 text-xs text-muted-foreground">{k}</dt>
                      <dd class="min-w-0 flex-1 break-words text-xs text-foreground">
                        {String(v ?? '—')}
                      </dd>
                    </div>
                  )}
                </For>
              </dl>
            </div>

            {/* The canonical map is read-only until real edit/trace flows are wired. */}
            <Show when={props.onEdit || props.onTrace}>
              <div class="flex gap-2 border-t border-border p-3">
                <Show when={props.onEdit}>
                  {onEdit => (
                    <button
                      type="button"
                      class="flex-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent"
                      onClick={onEdit()}
                    >
                      Sửa
                    </button>
                  )}
                </Show>
                <Show when={props.onTrace}>
                  {onTrace => (
                    <button
                      type="button"
                      class="flex-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent"
                      onClick={onTrace()}
                    >
                      Truy vết
                    </button>
                  )}
                </Show>
              </div>
            </Show>
          </aside>
        )
      }}
    </Show>
  )
}
