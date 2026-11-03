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

import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createFakePort } from '@wn/map-runtime/testing';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { createDraftFeature } from '@/entities/draft-feature';
import { DraftPlane } from './draft-plane';

function spyPort() {
  const port = createFakePort();
  const draftSets = () =>
    vi
      .mocked(port.setFeatures)
      .mock.calls.filter(([layerId]) => layerId === 'draft')
      .map(([, fc]) => fc);
  return { port, draftSets };
}

describe('DraftPlane', () => {
  it('pushes the draft collection to the draft layer', async () => {
    await createDraftFeature('snap-1', {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] },
    });
    const { port, draftSets } = spyPort();
    const qc = new QueryClient();
    render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DraftPlane snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(draftSets().length).toBeGreaterThan(0));
    expect(draftSets().at(-1)!.features).toHaveLength(1);
  });
});
