import type { Coordinate, SnapModes } from '@wn/map-runtime';
import type { MapHost, HostPointerEvent } from '../port/map-host.js';
import type { IconAtlas } from '../layers/icon-atlas.js';
import { emptyPrepared, type PreparedLayer } from '../layers/prepare-layer.js';
import type { LayerStore } from './layer-store.js';

export interface InteractionContext {
  host: MapHost;
  store: LayerStore;
  atlas: IconAtlas;
  snapModes(): SnapModes;
  /** Ask the engine to rebuild the deck layer list (overlay data changed). */
  requestRender(): void;
  /** Mark the pointer sequence as consumed so the engine does not synthesise a feature click from it. */
  suppressClick(): void;
}

export interface Interaction {
  /** Return true when the pointer event was consumed (later interactions skip it). */
  onPointer?(e: HostPointerEvent): boolean;
  onKey?(e: KeyboardEvent): boolean;
  /** The map moved: refresh anything cached in screen space. */
  onMove?(): void;
  /** Plain-data overlay painted above all feature layers. */
  overlay?(): PreparedLayer | null;
  destroy(): void;
}

export const TEAL = '#0E7C86';

export const emptyOverlay = (): PreparedLayer => emptyPrepared();

export const isEditableTarget = (e: KeyboardEvent): boolean =>
  e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

export const coordEq = (a: Coordinate, b: Coordinate): boolean => a.lon === b.lon && a.lat === b.lat;
