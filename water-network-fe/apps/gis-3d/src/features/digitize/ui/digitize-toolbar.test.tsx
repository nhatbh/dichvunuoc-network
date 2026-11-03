import { createSignal, onCleanup, onMount } from 'solid-js';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { httpClient } from '@/shared/api/http-client';

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

import { render, waitFor, fireEvent } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createFakePort } from '@wn/map-runtime-3d/testing';
import { MapRuntimeProvider } from '@/shared/lib/map-runtime';
import { DigitizeToolbar } from './digitize-toolbar';

function spyPort() {
  const port = createFakePort();
  return {
    port,
    drawModes: () => vi.mocked(port.setDrawMode).mock.calls.map(([g]) => g),
    modifyToggles: () => vi.mocked(port.setModifyMode).mock.calls.map(([e]) => e),
    featurePointToggles: () => vi.mocked(port.setFeaturePointMode).mock.calls.map(([e]) => e),
    selections: () => vi.mocked(port.setSelection).mock.calls.map(([id]) => id),
    emitFeaturePointPick: port.emitFeaturePointPick,
    emitDraw: port.emitDraw,
    emitModify: port.emitModify,
  };
}

describe('DigitizeToolbar', () => {
  it('presents task-oriented Vietnamese groups with persistent guidance', async () => {
    const { port } = spyPort();
    const qc = new QueryClient();
    const { getByRole, getByTestId, getByText } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));

    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    expect(getByRole('group', { name: 'Tạo mới' })).toBeInTheDocument();
    expect(getByRole('group', { name: 'Hiệu chỉnh' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Vẽ đường ống (L)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(getByText('Sẵn sàng biên tập')).toBeInTheDocument();

    fireEvent.click(getByTestId('edit-split'));
    expect(getByTestId('digitize-toolbar')).toHaveAttribute('data-mode', 'split');
    expect(getByText('Tách đường ống')).toBeInTheDocument();
    expect(getByText(/Nhấp đúng vị trí cần tách/)).toBeInTheDocument();
  });

  it('supports single-key tool shortcuts and Escape without stealing input keystrokes', async () => {
    const { port, drawModes } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));

    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.keyDown(window, { key: 'l' });
    expect(getByTestId('digitize-toolbar')).toHaveAttribute('data-mode', 'pipe');
    expect(drawModes().at(-1)).toBe('LineString');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'n' });
    expect(getByTestId('digitize-toolbar')).toHaveAttribute('data-mode', 'pipe');
    input.remove();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getByTestId('digitize-toolbar')).toHaveAttribute('data-mode', 'select');
    expect(drawModes().at(-1)).toBeNull();
  });

  it('maps pipe -> LineString draw mode and toggles off on second click', async () => {
    const { port, drawModes } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('draw-pipe'));
    expect(drawModes()).toContain('LineString');
    fireEvent.click(getByTestId('draw-pipe'));
    expect(drawModes().at(-1)).toBeNull();
  });

  it('fires the create command on draw completion and resets the mode', async () => {
    const { port, drawModes, emitDraw } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('draw-node'));
    emitDraw({ type: 'Point', coordinates: [105.8, 21] });
    await waitFor(() => expect(drawModes().at(-1)).toBeNull());
  });

  it('enables modify mode (and disables draw) when Modify is clicked', async () => {
    const { port, drawModes, modifyToggles } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-modify'));
    expect(modifyToggles().at(-1)).toBe(true);
    expect(drawModes().at(-1)).toBeNull();
  });

  it('fires the update command on modify completion without resetting the mode', async () => {
    const { port, modifyToggles, emitModify } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-modify'));
    emitModify('draft-1', { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] });
    await waitFor(() => expect(modifyToggles().at(-1)).toBe(true));
  });

  it('enables feature-point mode (and disables draw/modify) when Split is clicked', async () => {
    const { port, drawModes, modifyToggles, featurePointToggles } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-split'));
    expect(featurePointToggles().at(-1)).toBe(true);
    expect(modifyToggles().at(-1)).toBe(false);
    expect(drawModes().at(-1)).toBeNull();
  });

  it('enables feature-point mode (and disables draw/modify) when Connect is clicked', async () => {
    const { port, drawModes, modifyToggles, featurePointToggles } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-connect'));
    expect(featurePointToggles().at(-1)).toBe(true);
    expect(modifyToggles().at(-1)).toBe(false);
    expect(drawModes().at(-1)).toBeNull();
  });

  it('in Connect mode: picking a node then a pipe fires connectNodeToPipe and highlights the node', async () => {
    const { port, selections, emitFeaturePointPick } = spyPort();
    const qc = new QueryClient();
    // Seed the draft query cache so kind lookup resolves (node-1 = node, pipe-1 = pipe).
    qc.setQueryData(['draft-features', 'snap-1'], {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'node-1', geometry: { type: 'Point', coordinates: [105.79, 21] }, properties: { kind: 'node' } },
        { type: 'Feature', id: 'pipe-1', geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] }, properties: { kind: 'pipe' } },
      ],
    });
    const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue([]);
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-connect'));

    // Click 1: the node → highlighted, no command yet.
    emitFeaturePointPick('node-1', { lon: 105.79, lat: 21 });
    expect(selections().at(-1)).toBe('node-1');
    expect(postSpy).not.toHaveBeenCalled();

    // Click 2: the pipe → connect command fires with the pending node + atPoint.
    emitFeaturePointPick('pipe-1', { lon: 105.81, lat: 21.01 });
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [url, body] = postSpy.mock.calls[0]!;
    expect(url).toBe('/snapshot/snap-1/draft/features/pipe-1/connect');
    expect(body).toMatchObject({
      nodeId: 'node-1',
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
    });
    postSpy.mockRestore();
  });

  it('in Connect mode: picking a pipe with no pending node does nothing', async () => {
    const { port, emitFeaturePointPick } = spyPort();
    const qc = new QueryClient();
    qc.setQueryData(['draft-features', 'snap-1'], {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'pipe-1', geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] }, properties: { kind: 'pipe' } },
      ],
    });
    const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue([]);
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-connect'));
    emitFeaturePointPick('pipe-1', { lon: 105.81, lat: 21.01 });
    expect(postSpy).not.toHaveBeenCalled();
    postSpy.mockRestore();
  });

  it('in Connect mode: re-picking a node replaces the pending node (last node wins)', async () => {
    const { port, emitFeaturePointPick } = spyPort();
    const qc = new QueryClient();
    qc.setQueryData(['draft-features', 'snap-1'], {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'node-1', geometry: { type: 'Point', coordinates: [105.79, 21] }, properties: { kind: 'node' } },
        { type: 'Feature', id: 'node-2', geometry: { type: 'Point', coordinates: [105.78, 21] }, properties: { kind: 'node' } },
        { type: 'Feature', id: 'pipe-1', geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] }, properties: { kind: 'pipe' } },
      ],
    });
    const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue([]);
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    fireEvent.click(getByTestId('edit-connect'));
    // Pick node-1, then node-2 (re-pick) — node-2 becomes the pending node.
    emitFeaturePointPick('node-1', { lon: 105.79, lat: 21 });
    emitFeaturePointPick('node-2', { lon: 105.78, lat: 21 });
    // Now pick the pipe → connect fires with node-2, not node-1.
    emitFeaturePointPick('pipe-1', { lon: 105.81, lat: 21.01 });
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).toMatchObject({ nodeId: 'node-2' });
    postSpy.mockRestore();
  });

  it('does not touch map selection outside Connect mode (leaves canvas selection alone)', async () => {
    const { port, selections } = spyPort();
    const qc = new QueryClient();
    const { getByTestId } = render(() => (
      <QueryClientProvider client={qc}>
        <MapRuntimeProvider view={{ center: { lon: 105.8, lat: 21 }, zoom: 12 }} factory={async () => port}>
          <DigitizeToolbar snapshotId="snap-1" />
        </MapRuntimeProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(port.mount).toHaveBeenCalled());
    // Entering Split mode (not connect) must not push any selection.
    fireEvent.click(getByTestId('edit-split'));
    expect(vi.mocked(port.setSelection)).not.toHaveBeenCalled();
    expect(selections()).toHaveLength(0);
  });
});
