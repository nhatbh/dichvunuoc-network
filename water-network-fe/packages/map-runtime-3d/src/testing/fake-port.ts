import { vi } from 'vitest';
import { createFakePort as createFake2DPort, type FakeMapEnginePort } from '../../../map-runtime/src/testing/fake-port.js';
import type { Camera3D, Map3DPort, TerrainOptions } from '../port/map-engine-3d-port.js';
import { MODE_2D_CAMERA, MODE_3D_CAMERA } from '../port/map-engine-3d-port.js';

export interface FakeMap3DPort extends Map3DPort, FakeMapEnginePort {
  emitCamera(camera: Camera3D): void;
}

/** Fully-stubbed {@link Map3DPort}: the 2D fake plus camera / buildings / terrain. */
export function createFakePort(): FakeMap3DPort {
  const base = createFake2DPort();
  let camera: Camera3D = { ...MODE_2D_CAMERA };
  let buildings = false;
  let flow = true;
  let terrain: TerrainOptions = { enabled: false } as TerrainOptions;
  const subs = new Set<(c: Camera3D, zoom: number) => void>();
  const apply = (c: Camera3D) => { camera = c; subs.forEach((cb) => cb(c, 0)); };
  const extra = {
    getCamera: vi.fn(() => camera),
    setCamera: vi.fn((c: Partial<Camera3D>) => apply({ ...camera, ...c })),
    set3DMode: vi.fn((on: boolean) => apply({ ...camera, ...(on ? MODE_3D_CAMERA : MODE_2D_CAMERA) })),
    is3DMode: vi.fn(() => camera.pitch > 0),
    resetNorth: vi.fn(() => apply({ ...camera, bearing: 0 })),
    onCameraChange: vi.fn((cb: (c: Camera3D, zoom: number) => void) => { subs.add(cb); return () => subs.delete(cb); }),
    setFlowAnimation: vi.fn((on: boolean) => { flow = on; }),
    getFlowAnimation: vi.fn(() => flow),
    setBuildings: vi.fn((on: boolean) => { buildings = on; }),
    getBuildings: vi.fn(() => buildings),
    setTerrain: vi.fn((t: TerrainOptions) => { terrain = t; }),
    getTerrain: vi.fn(() => terrain),
    getVisibleBbox: vi.fn((): [number, number, number, number] => {
      // Top-down estimate for a 1024x700 canvas, mirroring a real 256px-tile view.
      const v = base.getView();
      const lonSpan = (360 * 1024) / (256 * 2 ** v.zoom);
      const latSpan = ((360 * 700) / (256 * 2 ** v.zoom)) * Math.cos((v.center.lat * Math.PI) / 180);
      return [v.center.lon - lonSpan / 2, v.center.lat - latSpan / 2, v.center.lon + lonSpan / 2, v.center.lat + latSpan / 2];
    }),
    emitCamera: (c: Camera3D) => apply(c),
  };
  return Object.assign(base, extra) as unknown as FakeMap3DPort;
}
export type { FakeMapEnginePort };
