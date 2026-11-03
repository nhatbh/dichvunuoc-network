import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';
import { createMapRuntime } from './use-map-runtime.js';
import { createFakePort } from '../testing/fake-port.js';

describe('createMapRuntime', () => {
  it('creates an instance via the injected factory and mounts on the ref', async () => {
    const port = createFakePort();
    const factory = vi.fn(async () => port);
    function Comp() {
      const { containerRef } = createMapRuntime({
        view: { center: { lon: 105.8, lat: 21 }, zoom: 12 },
        factory,
      });
      return <div ref={containerRef} style={{ width: '400px', height: '300px' }} />;
    }
    render(() => <Comp />);
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(port.mount).toHaveBeenCalledTimes(1));
  });
});
