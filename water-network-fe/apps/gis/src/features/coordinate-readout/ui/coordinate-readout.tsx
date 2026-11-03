import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { Coordinate } from '@wn/map-runtime';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';
import { createThrottledCallback } from '@/shared/lib/hooks/use-throttle';
import { cn } from '@/shared/lib/utils';
import { floatingSurface } from '@/shared/ui';

/** Live lon/lat under the cursor. Throttles display updates; clears on pointer-out. */
export function CoordinateReadout() {
  const { port } = useMapRuntimeContext();
  const [coord, setCoord] = createSignal<Coordinate | null>(null);
  const push = createThrottledCallback((c: Coordinate | null) => setCoord(c), 100);

  createEffect(() => {
    const p = port();
    if (!p) return;
    const off = p.onPointerMove((c) => push(c));
    onCleanup(off);
  });

  return (
    <div
      data-testid="coordinate-readout"
      class={cn('rounded-md px-2 py-1 font-mono text-xs text-muted-foreground', floatingSurface)}
    >
      <Show when={coord()} fallback={<span>—, —</span>}>
        {(c) => <span>{c().lon.toFixed(5)}, {c().lat.toFixed(5)}</span>}
      </Show>
    </div>
  );
}
