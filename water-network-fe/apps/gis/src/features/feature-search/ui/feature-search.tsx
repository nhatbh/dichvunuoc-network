import { createSignal, For, Show } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { searchFeaturesQueryOptions } from '@/entities/map-feature';
import type { FeatureSearchResult } from '@/entities/map-feature';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';
import { createDebouncedAccessor } from '@/shared/lib/hooks/use-debounce';
import { cn } from '@/shared/lib/utils';
import { floatingSurface } from '@/shared/ui';

/** Search features by name/id/kind. On pick: fit the map to the hit and emit
 * selection upward (the page wires it to the selection store). */
export function FeatureSearch(props: { snapshotId: string; onSelect: (id: string) => void }) {
  const { port } = useMapRuntimeContext();
  const [term, setTerm] = createSignal('');
  const debounced = createDebouncedAccessor(term, 200);
  const results = useQuery(() => searchFeaturesQueryOptions(props.snapshotId, debounced()));

  const pick = (hit: FeatureSearchResult) => {
    port()?.fitToBbox(hit.bbox, { maxZoom: 17, padding: 48 });
    props.onSelect(hit.id);
    setTerm('');
  };

  const list = () => results.data?.results ?? [];

  return (
    <div data-testid="feature-search" class="w-64">
      <input
        type="search"
        aria-label="Search features"
        placeholder="Search features…"
        value={term()}
        onInput={(e) => setTerm(e.currentTarget.value)}
        data-testid="search-input"
        class={cn('w-full rounded-lg px-3 py-1.5 text-sm', floatingSurface)}
      />
      <Show when={list().length > 0}>
        <ul class={cn('mt-1 max-h-64 overflow-auto rounded-lg', floatingSurface)}>
          <For each={list()}>
            {(r) => (
              <li>
                <button
                  type="button"
                  data-testid={`result-${r.id}`}
                  class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => pick(r)}
                >
                  <span>{r.name}</span>
                  <span class="text-xs text-muted-foreground">{r.kind}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
