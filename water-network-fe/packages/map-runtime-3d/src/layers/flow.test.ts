import { describe, expect, it } from 'vitest';
import { buildArrowInstances, buildFlow, computeDashes, computeParticles, type FlowParams } from './flow.js';
import type { Pos3 } from './prepare-layer.js';

// ~111 m due east of the origin (0.001° at lat 0)
const east: Pos3[] = [[0, 0, 0], [0.001, 0, 0]];
const params = (over: Partial<FlowParams> = {}): FlowParams => ({
  time: 0,
  metresPerPx: 1,
  pxPerSecPerMps: 10,
  spacingPx: 32,
  view: null,
  solids: false,
  maxParticles: 5000,
  tail: [0],
  ...over,
});
const xs = (p: ReturnType<typeof computeParticles>) => Array.from({ length: p.count }, (_, i) => p.positions[i * 3]!);

describe('computeParticles', () => {
  it('moves particles along the flow direction (east for +1, west for -1)', () => {
    const fwd = buildFlow('a', east, 1, 1, [0, 0, 255, 255], 0)!;
    const rev = buildFlow('a', east, 1, -1, [0, 0, 255, 255], 0)!;
    const t0 = computeParticles([fwd], params({ time: 0 }));
    const t1 = computeParticles([fwd], params({ time: 0.5 }));
    const first = (p: typeof t0) => Math.min(...xs(p));
    expect(first(t1)).toBeGreaterThan(first(t0)); // east: x grows
    const r0 = computeParticles([rev], params({ time: 0 }));
    const r1 = computeParticles([rev], params({ time: 0.5 }));
    expect(Math.min(...xs(r1))).toBeLessThan(Math.min(...xs(r0))); // west: x shrinks
  });

  it('higher speed (pressure) travels proportionally farther in the same time', () => {
    const slow = buildFlow('a', east, 1, 1, [0, 0, 255, 255], 0)!;
    const fast = buildFlow('a', east, 3, 1, [0, 0, 255, 255], 0)!;
    const advance = (f: typeof slow) => {
      const a = computeParticles([f], params({ time: 0 }));
      const b = computeParticles([f], params({ time: 0.1 }));
      return Math.min(...xs(b)) - Math.min(...xs(a));
    };
    // 10 px/s per m/s at 1 m/px: 1 m/s → 1 m in 0.1 s (≈9e-6°), 3 m/s → 3×
    expect(advance(fast) / advance(slow)).toBeCloseTo(3, 1);
  });

  it('keeps on-screen density constant across zoom (spacing follows metres/px)', () => {
    const f = buildFlow('a', east, 1, 1, [0, 0, 255, 255], 0)!;
    const near = computeParticles([f], params({ metresPerPx: 1 }));
    const far = computeParticles([f], params({ metresPerPx: 4 }));
    expect(near.count).toBeGreaterThan(far.count);
  });

  it('skips pipes outside the view and respects the particle cap', () => {
    const f = buildFlow('a', east, 1, 1, [0, 0, 255, 255], 0)!;
    expect(computeParticles([f], params({ view: [10, 10, 11, 11] })).count).toBe(0);
    expect(computeParticles([f], params({ maxParticles: 2 })).count).toBe(2);
  });

  it('lifts particles by the tube radius only in solid mode', () => {
    const f = buildFlow('a', east, 1, 1, [0, 0, 255, 255], 0.5)!;
    expect(computeParticles([f], params({ solids: false })).positions[2]).toBe(0);
    expect(computeParticles([f], params({ solids: true })).positions[2]).toBe(0.5);
  });

  it('draws a fading comet tail behind each particle', () => {
    const f = buildFlow('a', east, 1, 1, [0, 0, 255, 255], 0)!;
    const p = computeParticles([f], params({ tail: [0, 0.25], time: 5 }));
    const alphas = Array.from({ length: p.count }, (_, i) => p.colors[i * 4 + 3]!);
    expect(alphas).toContain(255);
    expect(Math.min(...alphas)).toBeLessThan(255);
  });
});

describe('computeDashes (flat pipes)', () => {
  const dp = { time: 0, metresPerPx: 1, pxPerSecPerMps: 10, periodPx: 16, dashPx: 8, view: null, maxSegments: 5000 };
  const f = buildFlow('d', east, 1, 1, [0, 100, 255, 255], 0, 4)!;
  const head = (d: ReturnType<typeof computeDashes>) => Math.max(...Array.from({ length: d.count }, (_, i) => d.targets[i * 3]!));

  it('never draws wider than the pipe stroke', () => {
    const d = computeDashes([f], dp);
    expect(d.count).toBeGreaterThan(0);
    for (let i = 0; i < d.count; i++) expect(d.widths[i]).toBeLessThanOrEqual(4);
  });

  it('is a dashed pattern: covered length is about dash/period of the pipe', () => {
    const d = computeDashes([f], dp);
    let len = 0;
    for (let i = 0; i < d.count; i++) len += Math.abs(d.targets[i * 3]! - d.sources[i * 3]!);
    const metres = len * 111_320;
    expect(metres / f.total).toBeGreaterThan(0.4);
    expect(metres / f.total).toBeLessThan(0.6);
  });

  it('slides along the flow direction and scales with speed', () => {
    const slow = computeDashes([f], dp);
    const later = computeDashes([f], { ...dp, time: 0.5 });
    expect(head(later)).toBeGreaterThan(head(slow) - 1e-9);
    const rev = buildFlow('d', east, 1, -1, [0, 100, 255, 255], 0, 4)!;
    const r0 = computeDashes([rev], dp);
    const r1 = computeDashes([rev], { ...dp, time: 0.5 });
    const minx = (d: typeof r0) => Math.min(...Array.from({ length: d.count }, (_, i) => d.sources[i * 3]!));
    expect(minx(r1)).toBeLessThan(minx(r0) + 1e-9);
  });
});

describe('close-up droplets', () => {
  it('stay at least a few tube-diameters apart however far you zoom in', () => {
    const tube = buildFlow('t', east, 1, 1, [0, 0, 255, 255], 0.05, 4)!; // r = 5 cm
    const pts = computeParticles([tube], params({ metresPerPx: 0.002, solids: true, spacingPx: 30 }));
    const sorted = xs(pts).sort((a, b) => a - b);
    const gapM = (sorted[1]! - sorted[0]!) * 111_320;
    expect(gapM).toBeGreaterThanOrEqual(0.05 * 2 * 3);
  });
});

describe('buildArrowInstances', () => {
  const tube = (dir: 1 | -1, speed = 1) => buildFlow('t', east, speed, dir, [0, 0, 255, 255], 0.5)!;

  it('puts four arrows around the tube at every station: top, right, bottom, left', () => {
    const a = buildArrowInstances([tube(1)]);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length % 4).toBe(0);
    // mesh +Z (third matrix column) is the radial direction of each arrow: up, side, down, side
    const radial = (i: number) => a[i]!.matrix.slice(8, 11).map((v) => Math.round(v / 0.5) || 0);
    expect(radial(0)).toEqual([0, 0, 1]);
    expect(radial(1)).toEqual([0, -1, 0]); // right of an eastward flow is south
    expect(radial(2)).toEqual([0, 0, -1]);
    expect(radial(3)).toEqual([0, 1, 0]);
    // anchored on the tube axis, one radius above the ground
    expect(a[0]!.position[2]).toBeCloseTo(0.5);
  });

  it('points along the flow and anchors at the upstream end of the segment', () => {
    const fwd = buildArrowInstances([tube(1)]);
    expect(fwd[0]!.matrix[0]).toBeGreaterThan(0); // +X of the mesh points east
    expect(fwd[0]!.position[0]).toBeLessThan(0.0005); // near the west end
    const rev = buildArrowInstances([tube(-1)]);
    expect(rev[0]!.matrix[0]).toBeLessThan(0); // west
    expect(rev[0]!.position[0]).toBeGreaterThan(0.0005); // near the east end
  });

  it('carries phase, loop, speed and usable length for the GPU, arrows evenly spread over the loop', () => {
    const a = buildArrowInstances([tube(1, 2)]);
    const rings = a.filter((_, i) => i % 4 === 0).map((x) => x.flow);
    const [, loop, speed, usable] = rings[0]!;
    expect(speed).toBe(2);
    expect(usable).toBeGreaterThan(100); // ~111 m pipe minus the flange gaps
    expect(loop).toBeGreaterThanOrEqual(usable);
    const gaps = rings.slice(1).map((r, i) => r[0] - rings[i]![0]);
    expect(new Set(gaps.map((g) => g.toFixed(6))).size).toBe(1);
  });

  it('skips pipes without a tube, standing water, and segments outside the cull box', () => {
    expect(buildArrowInstances([buildFlow('f', east, 1, 1, [0, 0, 255, 255], 0)!])).toHaveLength(0);
    expect(buildArrowInstances([tube(1, 0)])).toHaveLength(0);
    expect(buildArrowInstances([tube(1)], [0.01, 0.01, 0.02, 0.02])).toHaveLength(0);
    expect(buildArrowInstances([tube(1)], [-0.01, -0.01, 0.01, 0.01]).length).toBeGreaterThan(0);
  });
});
