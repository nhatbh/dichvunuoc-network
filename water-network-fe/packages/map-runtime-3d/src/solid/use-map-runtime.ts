import { createSignal, onCleanup, onMount } from 'solid-js';
import type { Map3DPort } from '../port/map-engine-3d-port.js';
import { createMapInstance, type MapViewOptions3D } from '../factory.js';

export interface UseMapRuntimeOptions {
  view: MapViewOptions3D;
  /** Override for tests; defaults to the lazy MapLibre + deck.gl factory. */
  factory?: (opts: MapViewOptions3D) => Promise<Map3DPort>;
}

export function createMapRuntime(opts: UseMapRuntimeOptions) {
  const [port, setPort] = createSignal<Map3DPort | null>(null);
  let container: HTMLDivElement | undefined;
  const create = opts.factory ?? createMapInstance;

  const containerRef = (el: HTMLDivElement) => { container = el; };

  onMount(async () => {
    const instance = await create(opts.view);
    if (container) instance.mount(container);
    setPort(instance);
  });

  onCleanup(() => { port()?.destroy(); });

  return { containerRef, port };
}
