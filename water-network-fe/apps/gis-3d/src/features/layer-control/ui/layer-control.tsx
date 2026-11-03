import { createSignal, For, Show } from 'solid-js';
import { BASEMAPS, type BasemapId } from '@wn/map-runtime-3d';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';
import { cn } from '@/shared/lib/utils';
import { floatingSurface } from '@/shared/ui';

/** Toggle the published vector layer and switch basemaps. Local UI state mirrors
 * the port; the port is the source of truth for the engine. */
export function LayerControl() {
  const { port } = useMapRuntimeContext();
  const [open, setOpen] = createSignal(false);
  const [vectorVisible, setVectorVisible] = createSignal(true);
  const [basemap, setBasemap] = createSignal<BasemapId>('osm');

  const toggleVector = () => {
    const next = !vectorVisible();
    setVectorVisible(next);
    port()?.setLayerVisible('published', next);
  };
  const chooseBasemap = (id: BasemapId) => {
    setBasemap(id);
    port()?.setBasemap(id);
  };

  return (
    <div data-testid="layer-control" class="text-sm">
      <button
        type="button"
        class={cn('rounded-lg px-3 py-1.5', floatingSurface)}
        onClick={() => setOpen((o) => !o)}
      >
        Layers ▾
      </button>
      <Show when={open()}>
        <div class={cn('mt-1 w-48 space-y-2 rounded-lg p-3', floatingSurface)}>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={vectorVisible()}
              onChange={toggleVector}
              data-testid="toggle-published"
            />
            Published features
          </label>
          <fieldset class="space-y-1">
            <legend class="text-xs text-muted-foreground">Basemap</legend>
            <For each={BASEMAPS}>
              {(b) => (
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    name="basemap"
                    value={b.id}
                    checked={basemap() === b.id}
                    onChange={() => chooseBasemap(b.id)}
                    data-testid={`basemap-${b.id}`}
                  />
                  {b.label}
                </label>
              )}
            </For>
          </fieldset>
        </div>
      </Show>
    </div>
  );
}
