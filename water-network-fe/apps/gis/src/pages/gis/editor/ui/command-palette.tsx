/* GIS — Biên tập: command palette ⌘K. Lọc EDITOR_ACTIONS theo query (label chứa chuỗi). */
import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Icon } from '../../lib/icons';
import type { EditorAction } from '../actions';

export function CommandPalette(props: {
  open: boolean;
  actions: EditorAction[];
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = createSignal('');
  createEffect(() => {
    if (!props.open) { setQ(''); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  const filtered = createMemo(() => {
    const s = q().trim().toLowerCase();
    return s ? props.actions.filter((a) => a.label.toLowerCase().includes(s)) : props.actions;
  });
  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh]">
          <button
            type="button"
            aria-label="Đóng bảng lệnh"
            class="absolute inset-0 cursor-default"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => props.onClose()}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Bảng lệnh"
            class="relative w-full max-w-[520px] overflow-hidden rounded-xl border border-line bg-[var(--surface)]"
            style={{ 'box-shadow': '0 24px 64px -16px rgba(0,0,0,0.5)' }}
          >
            <input
              autofocus
              aria-label="Tìm lệnh"
              value={q()}
              onInput={(e) => setQ(e.currentTarget.value)}
              placeholder="Tìm lệnh…"
              class="w-full border-b border-line bg-transparent px-4 py-3 text-[13px] text-[color:var(--text)] outline-none"
            />
            <div class="max-h-[320px] overflow-y-auto py-1">
              <For each={filtered()}>
                {(a) => (
                  <button onClick={() => { props.onRun(a.id); props.onClose(); }} class="flex w-full items-center gap-3 px-4 py-2 text-left text-[12.5px] text-[color:var(--text2)] hover:bg-[var(--surface2)]">
                    <span class="w-4 text-center opacity-85"><Icon name={a.icon} size={14} /></span>
                    <span class="flex-1">{a.label}</span>
                    <Show when={a.kbd}><span class="font-mono text-[10px] text-[color:var(--muted2)]">{a.kbd}</span></Show>
                  </button>
                )}
              </For>
              <Show when={filtered().length === 0}><div class="px-4 py-6 text-center text-[12px] text-[color:var(--muted)]">Không có lệnh khớp</div></Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
