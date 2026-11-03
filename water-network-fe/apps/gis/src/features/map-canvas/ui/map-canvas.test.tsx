import { createSignal, onCleanup, onMount } from 'solid-js';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';

// Isolate from the auth chain — mock-auth seeds localStorage at import time;
// mocking here prevents the side-effect running in the jsdom environment.
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}));
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}));

// @wn/map-runtime has its own node_modules/solid-js (different minor version).
// Re-implement createMapRuntime using the gis Solid instance so that
// all signals/effects share one reactive graph in tests.
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

import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createFakePort } from '@wn/map-runtime/testing';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { MapCanvas } from './map-canvas';

// jsdom's AbortSignal is a different class than Node's native AbortSignal, which
// is what the fetch interceptor (@mswjs/interceptors) validates with instanceof.
// Strip `signal` from all fetch calls in this test file to avoid the realm mismatch.
// This only affects test infrastructure — the component and http-client are unchanged.
let _origFetch: typeof globalThis.fetch;
beforeAll(() => {
  _origFetch = globalThis.fetch;
  globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return _origFetch(url, rest);
  };
});
afterAll(() => {
  globalThis.fetch = _origFetch;
});

const port = createFakePort();

describe('MapCanvas', () => {
  it('pushes fetched features into the context port and wires clicks', async () => {
    const qc = new QueryClient();
    render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <MapCanvas snapshotId="snap-1" onSelect={() => {}} selectedId={null} />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    await waitFor(() => expect(port.setFeatures).toHaveBeenCalledWith('published', expect.anything()));
    expect(port.onFeatureClick).toHaveBeenCalled();
  });
});
