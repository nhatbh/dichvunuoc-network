/* GIS — Biên tập: overlay bảng phím tắt (nhấn ?). */
import { For, Show, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { SHORTCUTS } from '../shortcuts';

export function ShortcutHelp(props: { open: boolean; onClose: () => void }) {
  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => { window.removeEventListener('keydown', onKey); });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-[80] flex items-center justify-center">
          <button
            type="button"
            aria-label="Đóng trợ giúp phím tắt"
            class="absolute inset-0 cursor-default"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={() => props.onClose()}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-help-title"
            class="relative w-full max-w-[420px] rounded-xl border border-line bg-[var(--surface)] p-5"
          >
            <h3 id="shortcut-help-title" class="mb-3 text-[14px] font-semibold text-[color:var(--text)]">Phím tắt</h3>
            <For each={SHORTCUTS}>
              {(s) => (
                <div class="flex items-center justify-between py-1.5 text-[12.5px] text-[color:var(--text2)]">
                  <span>{s.label}</span>
                  <span class="font-mono text-[11px] text-[color:var(--muted)]">{s.key}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
