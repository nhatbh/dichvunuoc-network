import { createSignal, onCleanup, onMount } from 'solid-js';
import type { MapEnginePort } from '../port/map-engine-port.js';
import type { MapViewOptions } from '../port/types.js';
import { createMapInstance } from '../factory.js';

export interface UseMapRuntimeOptions {
  view: MapViewOptions;
  /** Override for tests; defaults to the lazy OpenLayers factory. */
  factory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
}

export function createMapRuntime(opts: UseMapRuntimeOptions) {
  const [port, setPort] = createSignal<MapEnginePort | null>(null);
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
