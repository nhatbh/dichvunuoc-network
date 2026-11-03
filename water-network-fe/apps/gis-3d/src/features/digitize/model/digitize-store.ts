import { createSignal } from 'solid-js';
import type { NetworkFeatureKind } from '@wn/contracts/map-features';

/** Kinds the digitize tool draws. */
export type DrawKind = Extract<NetworkFeatureKind, 'pipe' | 'node'>;
/** Editor interaction modes: draw a kind, modify geometry, split a pipe, connect node↔pipe, or idle. */
export type EditMode = DrawKind | 'modify' | 'split' | 'connect';

/** Client UI state for the editor toolbar: the active interaction mode (null = idle) plus the
 *  node awaiting a pipe pick in connect mode. */
export function createDigitizeStore() {
  const [mode, setMode] = createSignal<EditMode | null>(null);
  const [pendingConnectNodeId, setPendingConnectNodeId] = createSignal<string | null>(null);
  const toggle = (m: EditMode) =>
    setMode((cur) => {
      setPendingConnectNodeId(null); // any mode change resets the pending node
      return cur === m ? null : m;
    });
  const clear = () => {
    setPendingConnectNodeId(null);
    setMode(null);
  };
  return { mode, toggle, clear, pendingConnectNodeId, setPendingConnectNodeId };
}
