import { z } from 'zod';
import { findComponent } from '../catalog/index.js';

/**
 * Network topology (`/api/gis/topology/*` on the BFF → topology-rs, decision 0029): isolation
 * zones, directed traces, nearest valves and structural issues over the published network.
 *
 * `isolate` and `trace` port topology-rs's graph rules so the demo mock answers the same way
 * offline: only components that `isolates` bound a segment (never check valves or PRVs),
 * `serves` devices are customers affected, `supplies`/`stores` nodes are trace sources, and
 * devices installed `state=closed` block traces.
 */

const Ids = z.array(z.string());

export const IsolationResult = z.object({
  valvesToClose: Ids,
  isolatedPipes: Ids,
  isolatedNodes: Ids,
  boundaryPipes: Ids,
  affectedServices: Ids,
  graphVersion: z.number(),
  /** False when topology-rs had no graph for the tenant and could not build one. */
  graphReady: z.boolean(),
});
export type IsolationResult = z.infer<typeof IsolationResult>;

export const TraceDirection = z.enum(['upstream', 'downstream', 'all']);
export type TraceDirection = z.infer<typeof TraceDirection>;

export const TraceResult = z.object({
  nodeIds: Ids,
  pipeIds: Ids,
  /** Upstream: the sources reached. */
  sourceNodeIds: Ids,
  graphVersion: z.number(),
  graphReady: z.boolean(),
});
export type TraceResult = z.infer<typeof TraceResult>;

export const NearestValvesResult = z.object({
  valves: z.array(z.object({ deviceId: z.string(), pipeId: z.string(), hops: z.number() })),
  graphVersion: z.number(),
  graphReady: z.boolean(),
});
export type NearestValvesResult = z.infer<typeof NearestValvesResult>;

export const TopologyIssuesResult = z.object({
  issues: z.array(
    z.object({ type: z.enum(['orphanNode', 'missingEndpoint', 'disconnectedComponent', 'unspecified']), assetIds: Ids }),
  ),
  graphVersion: z.number(),
  graphReady: z.boolean(),
});
export type TopologyIssuesResult = z.infer<typeof TopologyIssuesResult>;

/* ── the graph rules (port of topology-rs topology-core) ── */

/** A published asset as the graph needs it. */
export interface GraphAsset {
  id: string;
  kind: 'Node' | 'Pipe' | 'Device';
  componentCode?: string;
  fromRef?: string | null;
  toRef?: string | null;
  hostRef?: string | null;
  /** `state` property; `closed` blocks traces. */
  state?: string;
}

interface Pipe {
  id: string;
  from: string;
  to: string;
  valves: Set<string>;
  closed: boolean;
}

export interface TopologyGraph {
  pipes: Map<string, Pipe>;
  /** node → incident pipe ids */
  adjacent: Map<string, string[]>;
  sources: Set<string>;
  services: { id: string; pipe?: string; node?: string }[];
}

const does = (code: string | undefined, fn: string) => findComponent(code)?.functions.includes(fn as never) ?? false;

export function buildTopologyGraph(assets: GraphAsset[]): TopologyGraph {
  const pipes = new Map<string, Pipe>();
  const adjacent = new Map<string, string[]>();
  const sources = new Set<string>();
  const services: TopologyGraph['services'] = [];
  const link = (node: string, pipe: string) => adjacent.set(node, [...(adjacent.get(node) ?? []), pipe]);
  for (const a of assets) {
    if (a.kind === 'Pipe' && a.fromRef && a.toRef) {
      pipes.set(a.id, { id: a.id, from: a.fromRef, to: a.toRef, valves: new Set(), closed: false });
      link(a.fromRef, a.id);
      link(a.toRef, a.id);
    }
    if (a.kind === 'Node' && (does(a.componentCode, 'supplies') || does(a.componentCode, 'stores'))) sources.add(a.id);
  }
  for (const a of assets) {
    if (a.kind !== 'Device' || !a.hostRef) continue;
    const pipe = pipes.get(a.hostRef);
    if (pipe) {
      if (does(a.componentCode, 'isolates')) pipe.valves.add(a.id);
      if (a.state === 'closed') pipe.closed = true;
    }
    if (does(a.componentCode, 'serves')) services.push(pipe ? { id: a.id, pipe: pipe.id } : { id: a.id, node: a.hostRef });
  }
  return { pipes, adjacent, sources, services };
}

const other = (p: Pipe, node: string) => (p.from === node ? p.to : p.from);
const sorted = (s: Iterable<string>) => [...s].sort();

/** Isolation zone around a node or a pipe (topology-rs `compute_isolation`). */
export function isolate(g: TopologyGraph, start: { nodeId?: string; pipeId?: string }): Omit<IsolationResult, 'graphVersion' | 'graphReady'> {
  const nodes = new Set<string>();
  const pipes = new Set<string>();
  const boundary = new Set<string>();
  const valves = new Set<string>();
  const queue: string[] = [];
  const target = start.pipeId ? g.pipes.get(start.pipeId) : undefined;
  if (target) {
    pipes.add(target.id);
    if (target.valves.size) {
      boundary.add(target.id);
      target.valves.forEach((v) => valves.add(v));
    }
    for (const n of [target.from, target.to]) if (!nodes.has(n)) (nodes.add(n), queue.push(n));
  } else if (start.nodeId && g.adjacent.has(start.nodeId)) {
    nodes.add(start.nodeId);
    queue.push(start.nodeId);
  }
  while (queue.length) {
    const n = queue.shift()!;
    for (const id of g.adjacent.get(n) ?? []) {
      const p = g.pipes.get(id)!;
      if (target && p.id === target.id && boundary.has(p.id)) continue;
      if (p.valves.size === 0) {
        pipes.add(p.id);
        const nb = other(p, n);
        if (!nodes.has(nb)) (nodes.add(nb), queue.push(nb));
      } else {
        boundary.add(p.id);
        p.valves.forEach((v) => valves.add(v));
      }
    }
  }
  const affected = g.services.filter((s) => (s.pipe && pipes.has(s.pipe)) || (s.node && nodes.has(s.node))).map((s) => s.id);
  return {
    valvesToClose: sorted(valves),
    isolatedPipes: sorted(pipes),
    isolatedNodes: sorted(nodes),
    boundaryPipes: sorted(boundary),
    affectedServices: sorted(affected),
  };
}

/** Directed trace from a node (topology-rs `trace_directed`; `maxDepth` 0 = unbounded). */
export function trace(g: TopologyGraph, from: string, direction: TraceDirection, maxDepth = 0): Omit<TraceResult, 'graphVersion' | 'graphReady'> {
  if (!g.adjacent.has(from)) return { nodeIds: [], pipeIds: [], sourceNodeIds: [] };
  const limit = maxDepth || (direction === 'all' ? 20 : Infinity);
  const parent = new Map<string, { node: string; pipe: string }>();
  const depth = new Map<string, number>([[from, 0]]);
  const queue = [from];
  const reached: string[] = [];
  const allPipes = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    if (direction !== 'all' && n !== from && g.sources.has(n)) {
      reached.push(n);
      continue;
    }
    if (depth.get(n)! >= limit) continue;
    for (const id of g.adjacent.get(n) ?? []) {
      const p = g.pipes.get(id)!;
      if (direction === 'all') allPipes.add(p.id);
      else if (p.closed) continue;
      const nb = other(p, n);
      if (!depth.has(nb)) {
        depth.set(nb, depth.get(n)! + 1);
        parent.set(nb, { node: n, pipe: p.id });
        queue.push(nb);
      }
    }
  }
  if (direction === 'all') return { nodeIds: sorted(depth.keys()), pipeIds: sorted(allPipes), sourceNodeIds: [] };
  const upNodes = new Set([from]);
  const upPipes = new Set<string>();
  for (const src of reached) {
    for (let at: string | undefined = src; at && parent.has(at); at = parent.get(at)!.node) {
      upNodes.add(at);
      upPipes.add(parent.get(at)!.pipe);
    }
  }
  if (direction === 'upstream') return { nodeIds: sorted(upNodes), pipeIds: sorted(upPipes), sourceNodeIds: sorted(reached) };
  const seen = new Set([from]);
  const pipes = new Set<string>();
  const q: [string, number][] = [[from, 0]];
  while (q.length) {
    const [n, d] = q.shift()!;
    if (d >= limit) continue;
    for (const id of g.adjacent.get(n) ?? []) {
      const p = g.pipes.get(id)!;
      if (upPipes.has(p.id) || p.closed) continue;
      pipes.add(p.id);
      const nb = other(p, n);
      if (!seen.has(nb)) (seen.add(nb), q.push([nb, d + 1]));
    }
  }
  return { nodeIds: sorted(seen), pipeIds: sorted(pipes), sourceNodeIds: [] };
}
