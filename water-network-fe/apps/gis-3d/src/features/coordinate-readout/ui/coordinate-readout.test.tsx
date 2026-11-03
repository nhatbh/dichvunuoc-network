// --- Appendix A prelude START ---
import { createSignal, onCleanup, onMount } from 'solid-js';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}));
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}));
vi.mock('@wn/map-runtime-3d/solid', () => ({
  createMapRuntime: (opts: { view: unknown; factory?: (v: unknown) => Promise<unknown> }) => {
    const [port, setPort] = createSignal<unknown>(null);
    let container: HTMLDivElement | undefined;
    const containerRef = (el: HTMLDivElement) => { container = el; };
    onMount(async () => {
      const create = opts.factory!;
      const instance = await create(opts.view);
      const el = container ?? document.createElement('div');
      (instance as { mount: (el: HTMLDivElement) => void }).mount(el);
      setPort(instance);
    });
    onCleanup(() => { (port() as { destroy?: () => void })?.destroy?.(); });
    return { containerRef, port };
  },
}));

let _origFetch: typeof globalThis.fetch;
beforeAll(() => {
  _origFetch = globalThis.fetch;
  globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return _origFetch(url, rest);
  };
});
afterAll(() => { globalThis.fetch = _origFetch; });
// --- Appendix A prelude END ---

import { render, waitFor } from '@solidjs/testing-library';
import { createFakePort } from '@wn/map-runtime-3d/testing';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { CoordinateReadout } from './coordinate-readout';

describe('CoordinateReadout', () => {
  it('shows lon/lat on pointer move and a placeholder when the pointer leaves', async () => {
    const port = createFakePort();
    const { getByTestId } = render(() => (
      <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
        <CoordinateReadout />
      </MapRuntimeProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    port.emitPointer({ lon: 105.84321, lat: 21.01987 });
    await waitFor(() => expect(getByTestId('coordinate-readout')).toHaveTextContent('105.84321, 21.01987'));
    port.emitPointer(null);
    await waitFor(() => expect(getByTestId('coordinate-readout')).toHaveTextContent('—'));
  });
});
