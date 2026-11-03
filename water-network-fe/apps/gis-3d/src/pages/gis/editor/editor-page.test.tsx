import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}));
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}));
vi.mock('@wn/map-runtime-3d/solid', () => ({
  createMapRuntime: (opts: { view: unknown; factory?: (view: unknown) => Promise<unknown> }) => {
    const [port, setPort] = createSignal<unknown>(null);
    let container: HTMLDivElement | undefined;
    const containerRef = (element: HTMLDivElement) => {
      container = element;
    };
    onMount(async () => {
      const instance = await opts.factory!(opts.view);
      (instance as { mount: (element: HTMLDivElement) => void }).mount(
        container ?? document.createElement('div'),
      );
      setPort(instance);
    });
    onCleanup(() => (port() as { destroy?: () => void })?.destroy?.());
    return { containerRef, port };
  },
}));

let originalFetch: typeof globalThis.fetch;
beforeAll(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return originalFetch(url, rest);
  };
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createFakePort } from '@wn/map-runtime-3d/testing';
import { GisEditorPage } from './index';

describe('GisEditorPage', () => {
  it('integrates the task toolbar, map canvas, and draft plane in one editing workspace', async () => {
    const port = createFakePort();
    const qc = new QueryClient();
    const { getByRole, getByTestId, getByText } = render(() => (
      <QueryClientProvider client={qc}>
        <GisEditorPage snapshotId="snap-1" mapFactory={async () => port} />
      </QueryClientProvider>
    ));

    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    expect(getByTestId('map-canvas')).toBeInTheDocument();
    expect(getByRole('group', { name: 'Tạo mới' })).toBeInTheDocument();
    expect(getByText(/Đang biên tập bản nháp/)).toBeInTheDocument();

    fireEvent.click(getByTestId('draw-pipe'));
    expect(port.setDrawMode).toHaveBeenLastCalledWith('LineString');

    port.emitDraw({
      type: 'LineString',
      coordinates: [
        [105.8, 21],
        [105.81, 21.01],
      ],
    });
    await waitFor(() => {
      const draftCalls = vi.mocked(port.setFeatures).mock.calls.filter(([layer]) => layer === 'draft');
      expect(draftCalls.at(-1)?.[1].features).toHaveLength(1);
    });
  });
});
