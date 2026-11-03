import { createContext, useContext, type JSX } from 'solid-js';
import { createMapRuntime } from '@wn/map-runtime/solid';
import type { MapEnginePort, MapViewOptions } from '@wn/map-runtime';

export interface MapRuntimeContextValue {
  /** Attach to the map container <div>. */
  containerRef: (el: HTMLDivElement) => void;
  /** The live port once created (null until mounted). */
  port: () => MapEnginePort | null;
}

const MapRuntimeContext = createContext<MapRuntimeContextValue>();

/** Owns the single live map engine for the route. The `factory` prop is the one
 * test seam — inject a mock port here instead of threading it through features. */
export function MapRuntimeProvider(props: {
  view: MapViewOptions;
  factory?: (opts: MapViewOptions) => Promise<MapEnginePort>;
  children: JSX.Element;
}) {
  const { containerRef, port } = createMapRuntime({ view: props.view, factory: props.factory });
  return (
    <MapRuntimeContext.Provider value={{ containerRef, port }}>
      {props.children}
    </MapRuntimeContext.Provider>
  );
}

export function useMapRuntimeContext(): MapRuntimeContextValue {
  const ctx = useContext(MapRuntimeContext);
  if (!ctx) throw new Error('useMapRuntimeContext must be used within a MapRuntimeProvider');
  return ctx;
}
