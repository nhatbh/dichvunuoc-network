import { describe, expect, it } from 'vitest';
import { IsolationResult, TraceResult, buildTopologyGraph, isolate, trace, type GraphAsset } from './index.js';

// R(reservoir) ─p0─ n1 ─p1(gate)─ n2 ─p2─ n3 ─p3(check)─ n4 ; service connection on n3
const assets: GraphAsset[] = [
  { id: 'R', kind: 'Node', componentCode: 'Reservoir' },
  ...['n1', 'n2', 'n3', 'n4'].map((id): GraphAsset => ({ id, kind: 'Node', componentCode: 'Junction' })),
  { id: 'p0', kind: 'Pipe', fromRef: 'R', toRef: 'n1' },
  { id: 'p1', kind: 'Pipe', fromRef: 'n1', toRef: 'n2' },
  { id: 'p2', kind: 'Pipe', fromRef: 'n2', toRef: 'n3' },
  { id: 'p3', kind: 'Pipe', fromRef: 'n3', toRef: 'n4' },
  { id: 'gate', kind: 'Device', componentCode: 'GateValve', hostRef: 'p1' },
  { id: 'check', kind: 'Device', componentCode: 'CheckValve', hostRef: 'p3' },
  { id: 'svc', kind: 'Device', componentCode: 'ServiceConnection', hostRef: 'n3' },
];

describe('topology rules (port of topology-rs)', () => {
  const g = buildTopologyGraph(assets);

  it('isolates a pipe with the valves that isolate, never a check valve', () => {
    expect(isolate(g, { pipeId: 'p2' })).toEqual({
      valvesToClose: ['gate'],
      isolatedPipes: ['p2', 'p3'],
      isolatedNodes: ['n2', 'n3', 'n4'],
      boundaryPipes: ['p1'],
      affectedServices: ['svc'],
    });
  });

  it('traces up to the source and down to what it feeds; a closed valve blocks', () => {
    expect(trace(g, 'n2', 'upstream')).toEqual({ nodeIds: ['R', 'n1', 'n2'], pipeIds: ['p0', 'p1'], sourceNodeIds: ['R'] });
    expect(trace(g, 'n2', 'downstream').pipeIds).toEqual(['p2', 'p3']);
    const closed = buildTopologyGraph(assets.map((a) => (a.id === 'gate' ? { ...a, state: 'closed' } : a)));
    expect(trace(closed, 'n2', 'upstream').sourceNodeIds).toEqual([]);
  });

  it('parses the BFF responses', () => {
    expect(IsolationResult.parse({ ...isolate(g, { nodeId: 'n2' }), graphVersion: 3, graphReady: true }).graphReady).toBe(true);
    expect(() => TraceResult.parse({ nodeIds: [] })).toThrow();
  });
});
