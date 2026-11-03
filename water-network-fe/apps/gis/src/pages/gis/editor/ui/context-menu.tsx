/* GIS — Biên tập: menu chuột phải. Overlay dùng <Portal> (SolidJS). Render từ danh sách
   EditorAction đã lọc theo ngữ cảnh; kẻ separator giữa các nhóm `group`. */
import { For, Show, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Icon } from '../../lib/icons';
import type { EditorAction } from '../actions';

export function ContextMenu(props: {
  open: boolean;
  x: number;
  y: number;
  label?: string;
  actions: EditorAction[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    const onDown = () => props.onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    onCleanup(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); });
  });

  return (
    <Show when={props.open}>
      <Portal>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div
          class="fixed z-[70] min-w-[212px] rounded-lg border border-line bg-[var(--surface)] p-1.5"
          style={{ left: `${props.x}px`, top: `${props.y}px`, 'box-shadow': 'var(--toast-shadow)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Show when={props.label}>
            <div class="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{props.label}</div>
          </Show>
          <For each={props.actions}>
            {(a, i) => (
              <>
                <Show when={i() > 0 && props.actions[i() - 1]!.group !== a.group}>
                  <div class="my-1 h-px bg-[var(--line)]" />
                </Show>
                <button
                  onClick={() => { props.onPick(a.id); props.onClose(); }}
                  class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--surface2)]"
                  classList={{ 'text-[color:var(--danger,#D1242F)]': a.danger, 'text-[color:var(--text2)]': !a.danger }}
                >
                  <span class="w-4 text-center opacity-85"><Icon name={a.icon} size={14} /></span>
                  <span class="flex-1">{a.label}</span>
                  <Show when={a.kbd}><span class="font-mono text-[10px] text-[color:var(--muted2)]">{a.kbd}</span></Show>
                </button>
              </>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
}
