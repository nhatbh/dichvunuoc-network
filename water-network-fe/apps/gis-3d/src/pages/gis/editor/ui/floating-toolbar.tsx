/* GIS — Biên tập: thanh công cụ nổi cạnh selection (chỉ action `quick`) + nút ⋯ mở menu đầy đủ. */
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Icon } from '../../lib/icons';
import type { EditorAction } from '../actions';

export function FloatingToolbar(props: {
  open: boolean;
  x: number;
  y: number;
  actions: EditorAction[];
  onPick: (id: string) => void;
  onMore: () => void;
}) {
  return (
    <Show when={props.open}>
      <Portal>
        <div
          role="toolbar"
          aria-label="Lệnh chỉnh sửa nhanh"
          class="fixed z-[65] flex items-center gap-0.5 rounded-lg border border-line bg-[var(--surface)] p-1"
          style={{ left: `${props.x}px`, top: `${props.y}px`, transform: 'translate(-50%,-120%)', 'box-shadow': 'var(--card-shadow)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <For each={props.actions.filter((a) => a.quick)}>
            {(a) => (
              <button
                title={a.label}
                onClick={() => props.onPick(a.id)}
                class="flex h-7 w-8 items-center justify-center rounded-md hover:bg-[var(--surface2)]"
                classList={{ 'text-[color:var(--danger,#D1242F)]': a.danger, 'text-[color:var(--text2)]': !a.danger }}
              >
                <Icon name={a.icon} size={14} />
              </button>
            )}
          </For>
          <div class="mx-0.5 h-5 w-px bg-[var(--line)]" />
          <button
            title="Thêm lệnh"
            onClick={() => props.onMore()}
            class="flex h-7 w-8 items-center justify-center rounded-md text-[color:var(--text2)] hover:bg-[var(--surface2)]"
          >
            <Icon name="IcDots" size={14} />
          </button>
        </div>
      </Portal>
    </Show>
  );
}
