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
vi.mock('@wn/map-runtime/solid', () => ({
  createMapRuntime: (opts: { view: unknown; factory?: (v: unknown) => Promise<unknown> }) => {
    const [port, setPort] = createSignal<unknown>(null);
    let container: HTMLDivElement | undefined;
    const containerRef = (el: HTMLDivElement) => { container = el; };
    onMount(async () => {
      const create = opts.factory!;
      const instance = await create(opts.view);
      if (container) (instance as { mount: (el: HTMLDivElement) => void }).mount(container);
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
import { createFakePort } from '@wn/map-runtime/testing';
import { MapRuntimeProvider, useMapRuntimeContext } from './map-runtime-context';

const fakePort = createFakePort();

function Consumer() {
  const { containerRef, port } = useMapRuntimeContext();
  return <div ref={containerRef} data-testid="consumer">{port() ? 'ready' : 'pending'}</div>;
}

describe('MapRuntimeProvider', () => {
  it('creates one port via the factory and exposes it through context', async () => {
    const factory = vi.fn(async () => fakePort);
    const { getByTestId } = render(() => (
      <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={factory}>
        <Consumer />
      </MapRuntimeProvider>
    ));
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByTestId('consumer')).toHaveTextContent('ready'));
    expect(fakePort.mount).toHaveBeenCalledTimes(1);
  });
});
