import { For, createMemo } from 'solid-js'
import type { GisLayer } from '@/entities/gis'

interface LayerPanelProps {
  layers: GisLayer[]
  vis: Record<string, boolean>
  onToggle: (id: string) => void
}

export function LayerPanel(props: LayerPanelProps) {
  const grouped = createMemo(() => {
    const map = new Map<string, GisLayer[]>()
    for (const l of props.layers) {
      const group = map.get(l.grp) ?? []
      group.push(l)
      map.set(l.grp, group)
    }
    return map
  })

  return (
    <aside class="flex w-56 shrink-0 flex-col border-r border-border bg-background text-sm">
      <div class="border-b border-border px-3 py-2 font-semibold text-foreground">Lớp bản đồ</div>
      <div class="flex-1 overflow-y-auto">
        <For each={[...grouped().entries()]}>
          {([grp, layers]) => (
            <div>
              <div class="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {grp}
              </div>
              <For each={layers}>
                {(layer) => (
                  <LayerItem
                    layer={layer}
                    visible={props.vis[layer.id] ?? layer.on}
                    onToggle={props.onToggle}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>
      <div class="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        VN-2000 (EPSG:3405)
      </div>
    </aside>
  )
}

function LayerItem(props: { layer: GisLayer; visible: boolean; onToggle: (id: string) => void }) {
  const handleClick = () => {
    if (props.layer.lock) return
    props.onToggle(props.layer.id)
  }

  return (
    <button
      type="button"
      disabled={!!props.layer.lock}
      aria-pressed={props.visible}
      class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
      classList={{ 'cursor-default opacity-60': !!props.layer.lock }}
      onClick={handleClick}
    >
      <span
        class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border"
        aria-hidden="true"
      >
        {props.visible && !props.layer.lock ? (
          <span class="h-2 w-2 rounded-sm bg-foreground" />
        ) : props.layer.lock ? (
          <span class="h-2 w-2 rounded-sm bg-muted-foreground" />
        ) : null}
      </span>
      <span class="flex-1 truncate text-foreground">{props.layer.label}</span>
      {props.layer.count !== undefined && (
        <span class="text-xs text-muted-foreground">{props.layer.count}</span>
      )}
    </button>
  )
}
