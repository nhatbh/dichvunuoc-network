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

import { render, waitFor, fireEvent } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createFakePort } from '@wn/map-runtime/testing';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { FeatureSearch } from './feature-search';

function fitPort() {
  const port = createFakePort();
  const fits = () => vi.mocked(port.fitToBbox).mock.calls.map(([extent]) => extent);
  return { port, fits };
}

describe('FeatureSearch', () => {
  it('queries, lists hits, and on pick fits the map + emits onSelect', async () => {
    const qc = new QueryClient();
    const { port, fits } = fitPort();
    const selected: string[] = [];
    const { getByTestId, findByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <FeatureSearch snapshotId="snap-1" onSelect={(id) => selected.push(id)} />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.input(getByTestId('search-input'), { target: { value: 'feature' } });
    const first = await findByTestId('result-feat-1');
    fireEvent.click(first);
    expect(selected).toContain('feat-1');
    expect(fits()).toHaveLength(1);
    expect(fits()[0]).toHaveLength(4);
    const [minLon, minLat, maxLon, maxLat] = fits()[0]!;
    expect([minLon, minLat, maxLon, maxLat].every(Number.isFinite)).toBe(true);
    expect(minLon).toBeLessThanOrEqual(maxLon);
    expect(minLat).toBeLessThanOrEqual(maxLat);
    expect(fits()[0]).toEqual([105.8, 21.0, 105.8, 21.0]);
  });
});
