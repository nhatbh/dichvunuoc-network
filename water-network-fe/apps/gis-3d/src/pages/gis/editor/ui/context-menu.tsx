/* GIS — Biên tập: menu chuột phải. Overlay dùng <Portal> (SolidJS). Render từ danh sách
   EditorAction đã lọc theo ngữ cảnh; kẻ separator giữa các nhóm `group`. Luôn nằm trong màn
   hình, điều khiển được bằng bàn phím (↑ ↓ Enter Esc). */
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
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
  const [pos, setPos] = createSignal({ x: 0, y: 0 });
  const [active, setActive] = createSignal(-1);
  let box: HTMLDivElement | undefined;

  const pick = (id: string) => {
    props.onPick(id);
    props.onClose();
  };

  createEffect(() => {
    if (!props.open) return;
    setActive(-1);
    setPos({ x: props.x, y: props.y });
    // keep the whole menu on screen (flip left / up near the edges)
    queueMicrotask(() => {
      if (!box) return;
      const r = box.getBoundingClientRect();
      const x = props.x + r.width > window.innerWidth - 8 ? Math.max(8, props.x - r.width) : props.x;
      const y = props.y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - 8 - r.height) : props.y;
      setPos({ x, y });
    });
    const onKey = (e: KeyboardEvent) => {
      const n = props.actions.length;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose(); }
      else if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive((i) => (i + 1) % n); }
      else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive((i) => (i <= 0 ? n - 1 : i - 1)); }
      else if (e.key === 'Enter' && active() >= 0) { e.preventDefault(); e.stopPropagation(); pick(props.actions[active()]!.id); }
    };
    const onDown = () => props.onClose();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onDown);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onDown);
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div
          ref={box}
          role="menu"
          class="fixed z-[70] min-w-[228px] rounded-lg border border-line bg-[var(--surface)] p-1.5"
          style={{ left: `${pos().x}px`, top: `${pos().y}px`, 'box-shadow': 'var(--toast-shadow)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Show when={props.label}>
            <div class="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{props.label}</div>
          </Show>
          <Show when={props.actions.length} fallback={<div class="px-2.5 py-1.5 text-[12px] text-[color:var(--muted)]">Không có thao tác phù hợp</div>}>
            <For each={props.actions}>
              {(a, i) => (
                <>
                  <Show when={i() > 0 && props.actions[i() - 1]!.group !== a.group}>
                    <div class="my-1 h-px bg-[var(--line)]" />
                  </Show>
                  <button
                    role="menuitem"
                    onClick={() => pick(a.id)}
                    onMouseEnter={() => setActive(i())}
                    class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px]"
                    classList={{
                      'text-[color:var(--danger,#D1242F)]': a.danger,
                      'text-[color:var(--text2)]': !a.danger,
                      'bg-[var(--surface2)]': active() === i(),
                    }}
                  >
                    <span class="w-4 text-center opacity-85"><Icon name={a.icon} size={14} /></span>
                    <span class="flex-1">{a.label}</span>
                    <Show when={a.kbd}><span class="font-mono text-[10px] text-[color:var(--muted2)]">{a.kbd}</span></Show>
                  </button>
                </>
              )}
            </For>
          </Show>
        </div>
      </Portal>
    </Show>
  );
}
