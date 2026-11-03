import { createSignal } from 'solid-js';

/** One concern: which feature is currently selected. */
export function createSelectionStore() {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  return {
    selectedId,
    select: (id: string) => setSelectedId(id),
    clear: () => setSelectedId(null),
  };
}
