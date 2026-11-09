use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use petgraph::stable_graph::{EdgeIndex, NodeIndex, StableUnGraph};
use petgraph::visit::EdgeRef;
use serde::{Deserialize, Serialize};

/// Edge payload: the pipe id plus the set of valve device ids hosted on it.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipeEdge {
    pub pipe_id: String,
    /// Isolation valves hosted on the pipe (devices whose component `isolates`).
    pub valves: HashSet<String>,
    /// Devices on the pipe installed closed (`state=closed`): they block traces.
    #[serde(default)]
    pub closed: HashSet<String>,
}

/// Vertex payload. `registered` is true once a NodeRegistered/NodeRelocated
/// event was applied; false means the vertex exists only because a pipe
/// referenced it (a placeholder / missing endpoint).
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeVertex {
    pub node_id: String,
    #[serde(default)]
    pub registered: bool,
    /// Catalog component (decision 0028); empty for placeholder endpoints.
    #[serde(default)]
    pub component_code: String,
    /// Catalog functional flags, e.g. `supplies`/`stores` for sources.
    #[serde(default)]
    pub functions: Vec<String>,
}

/// Where an isolation starts: a node, or a pipe (the screen's usual target).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Start<'a> {
    Node(&'a str),
    Pipe(&'a str),
}

/// Trace direction. Upstream follows the network back to its sources (nodes that `supplies`
/// or `stores`); downstream is what the start feeds once that way back is cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    All,
    Upstream,
    Downstream,
}

/// Result of a directed trace.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Trace {
    pub node_ids: Vec<String>,
    pub pipe_ids: Vec<String>,
    /// Upstream only: the sources reached.
    pub source_node_ids: Vec<String>,
}

/// A device's placement, tracked so deletes can find and unmark the host edge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DevicePlacement {
    /// Catalog component code (decision 0028).
    #[serde(alias = "device_type")]
    pub component_code: String,
    /// Catalog functional flags; `isolates` devices bound an isolation segment, `serves`
    /// devices are customers affected by one.
    #[serde(default)]
    pub functions: Vec<String>,
    /// Installed closed (`state=closed`).
    #[serde(default)]
    pub closed: bool,
    pub host_pipe_id: Option<String>,
    pub host_node_id: Option<String>,
}

/// Deterministic, order-independent view of a NetworkGraph for test equality.
#[derive(Debug, Clone, PartialEq)]
pub struct CanonicalGraph {
    pub nodes: BTreeSet<String>,
    pub pipes: BTreeMap<String, (String, String, BTreeSet<String>)>,
    pub devices: BTreeMap<String, DevicePlacement>,
}

/// A topology problem found by `NetworkGraph::validate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopologyIssue {
    pub kind: IssueKind,
    pub asset_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueKind {
    OrphanNode,
    MissingEndpoint,
    DisconnectedComponent,
}

/// A valve reachable from a start node, with hop distance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NearestValve {
    pub device_id: String,
    pub pipe_id: String,
    pub distance: u32,
}

/// The result of an isolation computation: the valves to close to isolate the
/// incident's segment, and the nodes/pipes that become isolated.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct IsolationZone {
    pub valves_to_close: Vec<String>,
    pub isolated_nodes: Vec<String>,
    pub isolated_pipes: Vec<String>,
    /// Pipes whose valves close the segment.
    pub boundary_pipes: Vec<String>,
    /// Devices that `serves` customers on the isolated pipes and nodes.
    pub affected_services: Vec<String>,
}

impl DevicePlacement {
    pub fn does(&self, function: &str) -> bool {
        self.functions.iter().any(|f| f == function)
    }
}

fn sorted<I: IntoIterator<Item = String>>(items: I) -> Vec<String> {
    let mut v: Vec<String> = items.into_iter().collect();
    v.sort();
    v
}

/// One tenant's network as an undirected, stable graph.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct NetworkGraph {
    graph: StableUnGraph<NodeVertex, PipeEdge>,
    #[serde(skip)]
    node_ix: HashMap<String, NodeIndex>,
    #[serde(skip)]
    pipe_ix: HashMap<String, EdgeIndex>,
    devices: HashMap<String, DevicePlacement>,
}

impl NetworkGraph {
    /// Rebuild the transient `node_ix`/`pipe_ix` lookups after deserialization.
    pub fn reindex(&mut self) {
        self.node_ix.clear();
        self.pipe_ix.clear();
        for ix in self.graph.node_indices() {
            self.node_ix.insert(self.graph[ix].node_id.clone(), ix);
        }
        for ix in self.graph.edge_indices() {
            self.pipe_ix.insert(self.graph[ix].pipe_id.clone(), ix);
        }
    }

    pub fn upsert_node(&mut self, node_id: &str) -> NodeIndex {
        if let Some(&ix) = self.node_ix.get(node_id) {
            return ix;
        }
        let ix = self.graph.add_node(NodeVertex {
            node_id: node_id.to_string(),
            ..NodeVertex::default()
        });
        self.node_ix.insert(node_id.to_string(), ix);
        ix
    }

    /// Mark a node as backed by a real NodeRegistered/NodeRelocated event,
    /// creating the vertex first if a pipe already referenced it.
    pub fn register_node(&mut self, node_id: &str) {
        let ix = self.upsert_node(node_id);
        self.graph[ix].registered = true;
    }

    /// Record a node's catalog component (from NodeRegistered or the export).
    pub fn set_node_component(
        &mut self,
        node_id: &str,
        component_code: &str,
        functions: &[String],
    ) {
        let ix = self.upsert_node(node_id);
        self.graph[ix].component_code = component_code.to_string();
        self.graph[ix].functions = functions.to_vec();
    }

    pub fn add_pipe(&mut self, pipe_id: &str, from_node_id: &str, to_node_id: &str) {
        if self.pipe_ix.contains_key(pipe_id) {
            return; // idempotent: pipe already present
        }
        let a = self.upsert_node(from_node_id);
        let b = self.upsert_node(to_node_id);
        let ix = self.graph.add_edge(
            a,
            b,
            PipeEdge {
                pipe_id: pipe_id.to_string(),
                ..PipeEdge::default()
            },
        );
        self.pipe_ix.insert(pipe_id.to_string(), ix);
        // devices may arrive before their pipe (the export is ordered by id: device- < pipe-)
        for (id, d) in &self.devices {
            if d.host_pipe_id.as_deref() == Some(pipe_id) {
                if d.does("isolates") {
                    self.graph[ix].valves.insert(id.clone());
                }
                if d.closed {
                    self.graph[ix].closed.insert(id.clone());
                }
            }
        }
    }

    pub fn remove_pipe(&mut self, pipe_id: &str) {
        if let Some(ix) = self.pipe_ix.remove(pipe_id) {
            self.graph.remove_edge(ix);
        }
    }

    pub fn remove_node(&mut self, node_id: &str) {
        if let Some(ix) = self.node_ix.remove(node_id) {
            // remove_node also drops incident edges; purge those from pipe_ix.
            let dropped: HashSet<String> = self
                .graph
                .edges(ix)
                .map(|e| e.weight().pipe_id.clone())
                .collect();
            for pid in &dropped {
                self.pipe_ix.remove(pid);
            }
            self.graph.remove_node(ix);
            // Drop device placements orphaned by this removal — devices hosted on
            // a dropped incident pipe, or directly on the removed node — so state
            // and snapshots don't retain references to gone assets.
            self.devices.retain(|_, d| {
                let on_dropped_pipe = d
                    .host_pipe_id
                    .as_deref()
                    .is_some_and(|p| dropped.contains(p));
                let on_removed_node = d.host_node_id.as_deref() == Some(node_id);
                !on_dropped_pipe && !on_removed_node
            });
        }
    }

    pub fn set_device(
        &mut self,
        device_id: &str,
        component_code: &str,
        functions: &[String],
        closed: bool,
        host_pipe_id: Option<&str>,
        host_node_id: Option<&str>,
    ) {
        // If re-installing, clear any previous valve mark first.
        self.remove_device(device_id);
        let placement = DevicePlacement {
            component_code: component_code.to_string(),
            functions: functions.to_vec(),
            closed,
            host_pipe_id: host_pipe_id.map(str::to_string),
            host_node_id: host_node_id.map(str::to_string),
        };
        if let Some(&ix) = host_pipe_id.and_then(|pid| self.pipe_ix.get(pid)) {
            if placement.does("isolates") {
                self.graph[ix].valves.insert(device_id.to_string());
            }
            if closed {
                self.graph[ix].closed.insert(device_id.to_string());
            }
        }
        self.devices.insert(device_id.to_string(), placement);
    }

    pub fn remove_device(&mut self, device_id: &str) {
        if let Some(prev) = self.devices.remove(device_id) {
            if let Some(pid) = prev.host_pipe_id {
                if let Some(&ix) = self.pipe_ix.get(&pid) {
                    self.graph[ix].valves.remove(device_id);
                    self.graph[ix].closed.remove(device_id);
                }
            }
        }
    }

    pub fn node_count(&self) -> usize {
        self.graph.node_count()
    }
    pub fn pipe_count(&self) -> usize {
        self.graph.edge_count()
    }
    pub fn has_pipe(&self, pipe_id: &str) -> bool {
        self.pipe_ix.contains_key(pipe_id)
    }
    pub fn has_node(&self, node_id: &str) -> bool {
        self.node_ix.contains_key(node_id)
    }
    pub fn pipe_has_valve(&self, pipe_id: &str) -> bool {
        self.pipe_ix
            .get(pipe_id)
            .map(|&ix| !self.graph[ix].valves.is_empty())
            .unwrap_or(false)
    }

    /// Structural validation: orphan registered nodes, placeholder (missing)
    /// endpoints, and disconnected components (all but the largest).
    pub fn validate(&self) -> Vec<TopologyIssue> {
        let mut issues = Vec::new();

        let mut node_ids: Vec<&String> = self.node_ix.keys().collect();
        node_ids.sort();
        for nid in &node_ids {
            let ix = self.node_ix[*nid];
            if !self.graph[ix].registered {
                issues.push(TopologyIssue {
                    kind: IssueKind::MissingEndpoint,
                    asset_ids: vec![(*nid).clone()],
                });
            } else if self.graph.neighbors(ix).next().is_none() {
                issues.push(TopologyIssue {
                    kind: IssueKind::OrphanNode,
                    asset_ids: vec![(*nid).clone()],
                });
            }
        }

        let mut components = self.connected_components();
        components.sort_by(|a, b| {
            b.len()
                .cmp(&a.len())
                .then_with(|| a.first().cmp(&b.first()))
        });
        for comp in components.into_iter().skip(1) {
            issues.push(TopologyIssue {
                kind: IssueKind::DisconnectedComponent,
                asset_ids: comp,
            });
        }

        issues
    }

    /// All connected components as sorted lists of node ids.
    fn connected_components(&self) -> Vec<Vec<String>> {
        use std::collections::VecDeque;
        let mut seen: HashSet<NodeIndex> = HashSet::new();
        let mut out: Vec<Vec<String>> = Vec::new();
        let mut starts: Vec<(&String, NodeIndex)> =
            self.node_ix.iter().map(|(k, &v)| (k, v)).collect();
        starts.sort_by(|a, b| a.0.cmp(b.0));
        for (_, start) in starts {
            if seen.contains(&start) {
                continue;
            }
            let mut comp: Vec<String> = Vec::new();
            let mut q = VecDeque::new();
            seen.insert(start);
            q.push_back(start);
            while let Some(ix) = q.pop_front() {
                comp.push(self.graph[ix].node_id.clone());
                for nb in self.graph.neighbors(ix) {
                    if seen.insert(nb) {
                        q.push_back(nb);
                    }
                }
            }
            comp.sort();
            out.push(comp);
        }
        out
    }

    /// Depth-limited undirected BFS from `start_node_id`. Returns reached node
    /// ids and traversed pipe ids (both sorted). Empty if start absent.
    pub fn trace(&self, start_node_id: &str, max_depth: u32) -> (Vec<String>, Vec<String>) {
        use std::collections::VecDeque;
        let Some(&start) = self.node_ix.get(start_node_id) else {
            return (Vec::new(), Vec::new());
        };
        let mut visited: HashSet<NodeIndex> = HashSet::new();
        let mut pipes: HashSet<String> = HashSet::new();
        let mut q: VecDeque<(NodeIndex, u32)> = VecDeque::new();
        visited.insert(start);
        q.push_back((start, 0));
        while let Some((ix, depth)) = q.pop_front() {
            if depth >= max_depth {
                continue;
            }
            for e in self.graph.edges(ix) {
                pipes.insert(e.weight().pipe_id.clone());
                let nb = if e.source() == ix {
                    e.target()
                } else {
                    e.source()
                };
                if visited.insert(nb) {
                    q.push_back((nb, depth + 1));
                }
            }
        }
        let mut node_ids: Vec<String> = visited
            .iter()
            .map(|&i| self.graph[i].node_id.clone())
            .collect();
        let mut pipe_ids: Vec<String> = pipes.into_iter().collect();
        node_ids.sort();
        pipe_ids.sort();
        (node_ids, pipe_ids)
    }

    /// The `k` nearest valves (by hop distance) reachable from `start_node_id`,
    /// sorted by (distance, pipe_id, device_id). Empty if start absent.
    pub fn nearest_valves(&self, start_node_id: &str, k: usize) -> Vec<NearestValve> {
        use std::collections::VecDeque;
        let Some(&start) = self.node_ix.get(start_node_id) else {
            return Vec::new();
        };
        let mut dist: HashMap<NodeIndex, u32> = HashMap::new();
        let mut q: VecDeque<NodeIndex> = VecDeque::new();
        let mut found: Vec<NearestValve> = Vec::new();
        let mut seen_pipes: HashSet<String> = HashSet::new();
        dist.insert(start, 0);
        q.push_back(start);
        while let Some(ix) = q.pop_front() {
            let d = dist[&ix];
            for e in self.graph.edges(ix) {
                let w = e.weight();
                if !w.valves.is_empty() && seen_pipes.insert(w.pipe_id.clone()) {
                    for dev in &w.valves {
                        found.push(NearestValve {
                            device_id: dev.clone(),
                            pipe_id: w.pipe_id.clone(),
                            distance: d,
                        });
                    }
                }
                let nb = if e.source() == ix {
                    e.target()
                } else {
                    e.source()
                };
                if let std::collections::hash_map::Entry::Vacant(slot) = dist.entry(nb) {
                    slot.insert(d + 1);
                    q.push_back(nb);
                }
            }
        }
        found.sort_by(|a, b| {
            a.distance
                .cmp(&b.distance)
                .then(a.pipe_id.cmp(&b.pipe_id))
                .then(a.device_id.cmp(&b.device_id))
        });
        found.truncate(k);
        found
    }

    /// Isolation zone around a node (kept for the incident flow).
    pub fn compute_isolation_zone(&self, start_node_id: &str) -> IsolationZone {
        self.compute_isolation(Start::Node(start_node_id))
    }

    /// Compute the valve-segment isolation zone around a node or a pipe: BFS over valveless
    /// pipes builds the segment; every valved pipe incident to it is a boundary whose isolation
    /// valves must close. A target pipe is always isolated; its own valves close too and the
    /// segment grows from both of its ends (the break side is unknown). Only devices whose
    /// component `isolates` count as valves (decision 0028). Empty if the start is absent.
    pub fn compute_isolation(&self, start: Start<'_>) -> IsolationZone {
        use std::collections::VecDeque;
        let mut in_segment: HashSet<NodeIndex> = HashSet::new();
        let mut isolated_pipes: HashSet<String> = HashSet::new();
        let mut boundary: HashSet<String> = HashSet::new();
        let mut valves: HashSet<String> = HashSet::new();
        let mut q: VecDeque<NodeIndex> = VecDeque::new();
        match start {
            Start::Node(id) => {
                if let Some(&ix) = self.node_ix.get(id) {
                    in_segment.insert(ix);
                    q.push_back(ix);
                }
            }
            Start::Pipe(id) => {
                if let Some(&ix) = self.pipe_ix.get(id) {
                    let w = &self.graph[ix];
                    isolated_pipes.insert(w.pipe_id.clone());
                    if !w.valves.is_empty() {
                        boundary.insert(w.pipe_id.clone());
                        valves.extend(w.valves.iter().cloned());
                    }
                    let (a, b) = self.graph.edge_endpoints(ix).expect("edge index is valid");
                    for n in [a, b] {
                        if in_segment.insert(n) {
                            q.push_back(n);
                        }
                    }
                }
            }
        }
        if in_segment.is_empty() {
            return IsolationZone::default();
        }
        while let Some(ix) = q.pop_front() {
            for e in self.graph.edges(ix) {
                let w = e.weight();
                if isolated_pipes.contains(&w.pipe_id) && boundary.contains(&w.pipe_id) {
                    continue; // the target pipe's own valves are already closing
                }
                if w.valves.is_empty() {
                    // valveless pipe: internal to the segment — traverse it
                    isolated_pipes.insert(w.pipe_id.clone());
                    let nb = if e.source() == ix {
                        e.target()
                    } else {
                        e.source()
                    };
                    if in_segment.insert(nb) {
                        q.push_back(nb);
                    }
                } else {
                    // valved pipe: boundary — close its valves, do not cross
                    boundary.insert(w.pipe_id.clone());
                    valves.extend(w.valves.iter().cloned());
                }
            }
        }
        let isolated_node_ids: HashSet<String> = in_segment
            .iter()
            .map(|&i| self.graph[i].node_id.clone())
            .collect();
        let affected: Vec<String> = self
            .devices
            .iter()
            .filter(|(_, d)| d.does("serves"))
            .filter(|(_, d)| {
                d.host_pipe_id
                    .as_ref()
                    .is_some_and(|p| isolated_pipes.contains(p))
                    || d.host_node_id
                        .as_ref()
                        .is_some_and(|n| isolated_node_ids.contains(n))
            })
            .map(|(id, _)| id.clone())
            .collect();
        IsolationZone {
            valves_to_close: sorted(valves),
            isolated_nodes: sorted(isolated_node_ids),
            isolated_pipes: sorted(isolated_pipes),
            boundary_pipes: sorted(boundary),
            affected_services: sorted(affected),
        }
    }

    /// Directed trace from a node. Closed devices block their pipe. `max_depth` bounds every
    /// direction (0 = unbounded for upstream/downstream).
    pub fn trace_directed(
        &self,
        start_node_id: &str,
        direction: Direction,
        max_depth: u32,
    ) -> Trace {
        use std::collections::VecDeque;
        let Some(&start) = self.node_ix.get(start_node_id) else {
            return Trace::default();
        };
        if direction == Direction::All {
            let (node_ids, pipe_ids) = self.trace(start_node_id, max_depth);
            return Trace {
                node_ids,
                pipe_ids,
                source_node_ids: Vec::new(),
            };
        }
        let limit = if max_depth == 0 { u32::MAX } else { max_depth };
        let is_source = |ix: NodeIndex| {
            self.graph[ix]
                .functions
                .iter()
                .any(|f| f == "supplies" || f == "stores")
        };
        // BFS over open pipes, remembering how each node was reached
        let mut parent: HashMap<NodeIndex, (NodeIndex, EdgeIndex)> = HashMap::new();
        let mut depth: HashMap<NodeIndex, u32> = HashMap::from([(start, 0)]);
        let mut q: VecDeque<NodeIndex> = VecDeque::from([start]);
        let mut sources: Vec<NodeIndex> = Vec::new();
        while let Some(ix) = q.pop_front() {
            if ix != start && is_source(ix) {
                sources.push(ix); // do not trace through a source
                continue;
            }
            let d = depth[&ix];
            if d >= limit {
                continue;
            }
            for e in self.graph.edges(ix) {
                if !e.weight().closed.is_empty() {
                    continue;
                }
                let nb = if e.source() == ix {
                    e.target()
                } else {
                    e.source()
                };
                if let std::collections::hash_map::Entry::Vacant(slot) = depth.entry(nb) {
                    slot.insert(d + 1);
                    parent.insert(nb, (ix, e.id()));
                    q.push_back(nb);
                }
            }
        }
        // the way back to the sources: the shortest path to each one
        let mut up_nodes: HashSet<NodeIndex> = HashSet::from([start]);
        let mut up_pipes: HashSet<EdgeIndex> = HashSet::new();
        for &src in &sources {
            let mut at = src;
            while let Some(&(prev, edge)) = parent.get(&at) {
                up_nodes.insert(at);
                up_pipes.insert(edge);
                at = prev;
            }
        }
        let name_nodes =
            |set: &HashSet<NodeIndex>| sorted(set.iter().map(|&i| self.graph[i].node_id.clone()));
        let name_pipes =
            |set: &HashSet<EdgeIndex>| sorted(set.iter().map(|&i| self.graph[i].pipe_id.clone()));
        if direction == Direction::Upstream {
            return Trace {
                node_ids: name_nodes(&up_nodes),
                pipe_ids: name_pipes(&up_pipes),
                source_node_ids: sorted(sources.iter().map(|&i| self.graph[i].node_id.clone())),
            };
        }
        // downstream: reachable from the start without the pipes leading back to a source
        let mut seen: HashSet<NodeIndex> = HashSet::from([start]);
        let mut pipes: HashSet<EdgeIndex> = HashSet::new();
        let mut q: VecDeque<(NodeIndex, u32)> = VecDeque::from([(start, 0)]);
        while let Some((ix, d)) = q.pop_front() {
            if d >= limit {
                continue;
            }
            for e in self.graph.edges(ix) {
                if up_pipes.contains(&e.id()) || !e.weight().closed.is_empty() {
                    continue;
                }
                pipes.insert(e.id());
                let nb = if e.source() == ix {
                    e.target()
                } else {
                    e.source()
                };
                if seen.insert(nb) {
                    q.push_back((nb, d + 1));
                }
            }
        }
        Trace {
            node_ids: name_nodes(&seen),
            pipe_ids: name_pipes(&pipes),
            source_node_ids: Vec::new(),
        }
    }

    /// Order-independent logical snapshot for equality assertions in tests
    /// (NetworkGraph can't derive PartialEq because petgraph's StableGraph
    /// doesn't implement it).
    pub fn canonical(&self) -> CanonicalGraph {
        let nodes: BTreeSet<String> = self.node_ix.keys().cloned().collect();
        let pipes: BTreeMap<String, (String, String, BTreeSet<String>)> = self
            .pipe_ix
            .iter()
            .map(|(pid, &ix)| {
                let (a, b) = self.graph.edge_endpoints(ix).expect("edge index is valid");
                let mut ends = [self.graph[a].node_id.clone(), self.graph[b].node_id.clone()];
                ends.sort(); // undirected: normalize endpoint order
                let [u, v] = ends;
                let valves: BTreeSet<String> = self.graph[ix].valves.iter().cloned().collect();
                (pid.clone(), (u, v, valves))
            })
            .collect();
        let devices: BTreeMap<String, DevicePlacement> = self
            .devices
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        CanonicalGraph {
            nodes,
            pipes,
            devices,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(functions: &[&str]) -> Vec<String> {
        functions.iter().map(|f| f.to_string()).collect()
    }

    #[test]
    fn upsert_node_is_idempotent_on_index() {
        let mut g = NetworkGraph::default();
        let a = g.upsert_node("n1");
        let b = g.upsert_node("n1");
        assert_eq!(a, b, "same node id maps to the same vertex");
        assert_eq!(g.node_count(), 1);
    }

    #[test]
    fn add_pipe_creates_endpoints_when_missing() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        assert_eq!(
            g.node_count(),
            2,
            "missing endpoints are created implicitly"
        );
        assert_eq!(g.pipe_count(), 1);
        assert!(g.has_pipe("p1"));
    }

    #[test]
    fn remove_pipe_drops_edge_only() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.remove_pipe("p1");
        assert!(!g.has_pipe("p1"));
        assert_eq!(g.node_count(), 2, "endpoints remain");
    }

    #[test]
    fn valve_marks_host_edge() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.set_device(
            "d1",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p1"),
            None,
        );
        assert!(g.pipe_has_valve("p1"));
        g.remove_device("d1");
        assert!(!g.pipe_has_valve("p1"));
    }

    #[test]
    fn non_valve_device_does_not_mark_edge() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.set_device("d1", "PressureSensor", &fx(&[]), false, Some("p1"), None);
        assert!(!g.pipe_has_valve("p1"));
    }

    #[test]
    fn remove_node_drops_orphaned_device_placements() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2"); // p1 is incident to n1
        g.set_device(
            "d_pipe",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p1"),
            None,
        ); // hosted on p1
        g.set_device("d_node", "Hydrant", &fx(&[]), false, None, Some("n1")); // hosted on n1
        g.set_device("d_keep", "Hydrant", &fx(&[]), false, None, Some("n2")); // hosted on the surviving node

        g.remove_node("n1");

        let devices = g.canonical().devices;
        assert!(
            !devices.contains_key("d_pipe"),
            "device on dropped incident pipe is purged"
        );
        assert!(
            !devices.contains_key("d_node"),
            "device on the removed node is purged"
        );
        assert!(
            devices.contains_key("d_keep"),
            "device on a surviving node is kept"
        );
    }

    #[test]
    fn validate_flags_orphan_registered_node() {
        let mut g = NetworkGraph::default();
        g.register_node("n_lonely"); // registered, no edges
        g.add_pipe("p1", "n1", "n2"); // n1,n2 connected
        g.register_node("n1");
        g.register_node("n2");
        let issues = g.validate();
        assert!(issues.iter().any(
            |i| i.kind == IssueKind::OrphanNode && i.asset_ids == vec!["n_lonely".to_string()]
        ));
    }

    #[test]
    fn validate_flags_missing_endpoint_placeholder() {
        let mut g = NetworkGraph::default();
        g.register_node("n1");
        g.add_pipe("p1", "n1", "n_ghost"); // n_ghost never registered → placeholder
        let issues = g.validate();
        assert!(issues
            .iter()
            .any(|i| i.kind == IssueKind::MissingEndpoint
                && i.asset_ids == vec!["n_ghost".to_string()]));
        assert!(!issues.iter().any(
            |i| i.kind == IssueKind::MissingEndpoint && i.asset_ids.contains(&"n1".to_string())
        ));
    }

    #[test]
    fn validate_flags_disconnected_components_except_largest() {
        let mut g = NetworkGraph::default();
        g.add_pipe("pa1", "a1", "a2");
        g.add_pipe("pa2", "a2", "a3");
        for n in ["a1", "a2", "a3"] {
            g.register_node(n);
        }
        g.add_pipe("pb1", "b1", "b2");
        for n in ["b1", "b2"] {
            g.register_node(n);
        }
        let issues = g.validate();
        let disc: Vec<_> = issues
            .iter()
            .filter(|i| i.kind == IssueKind::DisconnectedComponent)
            .collect();
        assert_eq!(disc.len(), 1, "only the smaller component is reported");
        assert_eq!(disc[0].asset_ids, vec!["b1".to_string(), "b2".to_string()]);
    }

    #[test]
    fn validate_clean_graph_has_no_issues() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.register_node("n1");
        g.register_node("n2");
        assert!(g.validate().is_empty());
    }

    #[test]
    fn trace_returns_nodes_and_pipes_within_depth() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.add_pipe("p3", "n3", "n4"); // n4 is 3 hops from n1
        let (nodes, pipes) = g.trace("n1", 2);
        assert_eq!(nodes, vec!["n1", "n2", "n3"]); // n4 excluded (depth 3)
        assert_eq!(pipes, vec!["p1", "p2"]);
    }

    #[test]
    fn trace_unknown_start_is_empty() {
        let g = NetworkGraph::default();
        assert_eq!(
            g.trace("nope", 5),
            (Vec::<String>::new(), Vec::<String>::new())
        );
    }

    #[test]
    fn nearest_valves_sorted_by_distance() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.add_pipe("p3", "n3", "n4");
        g.set_device(
            "v_far",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p3"),
            None,
        ); // ~2 hops from n1
        g.set_device(
            "v_near",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p1"),
            None,
        ); // 0 hops from n1
        let valves = g.nearest_valves("n1", 5);
        let ids: Vec<&str> = valves.iter().map(|v| v.device_id.as_str()).collect();
        assert_eq!(ids, vec!["v_near", "v_far"]);
        assert_eq!(valves[0].distance, 0);
        assert_eq!(valves[0].pipe_id, "p1");
        assert!(valves[1].distance <= 2);
    }

    #[test]
    fn isolation_closes_gate_and_butterfly_valves_but_never_check_valves_or_prvs() {
        // n1 -p1(check valve)- n2 -p2(PRV)- n3 -p3(butterfly)- n4 ; n1 -p0(gate)- n0
        let mut g = NetworkGraph::default();
        g.add_pipe("p0", "n0", "n1");
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.add_pipe("p3", "n3", "n4");
        g.set_device(
            "gate",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p0"),
            None,
        );
        g.set_device("check", "CheckValve", &fx(&[]), false, Some("p1"), None);
        g.set_device("prv", "PRV", &fx(&[]), false, Some("p2"), None);
        g.set_device(
            "bfv",
            "ButterflyValve",
            &fx(&["isolates"]),
            false,
            Some("p3"),
            None,
        );
        let zone = g.compute_isolation_zone("n2");
        assert_eq!(
            zone.valves_to_close,
            vec!["bfv".to_string(), "gate".to_string()]
        );
        assert!(g
            .nearest_valves("n2", 10)
            .iter()
            .all(|v| v.device_id != "check" && v.device_id != "prv"));
    }

    /// reservoir R ─p0─ n1 ─p1(gate)─ n2 ─p2─ n3 ─p3(check)─ n4, service on p2, meter on n3
    fn small_network() -> NetworkGraph {
        let mut g = NetworkGraph::default();
        g.add_pipe("p0", "R", "n1");
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.add_pipe("p3", "n3", "n4");
        g.set_node_component("R", "Reservoir", &fx(&["stores"]));
        g.set_device(
            "gate",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p1"),
            None,
        );
        g.set_device(
            "check",
            "CheckValve",
            &fx(&["controls"]),
            false,
            Some("p3"),
            None,
        );
        g.set_device(
            "svc",
            "ServiceConnection",
            &fx(&["serves"]),
            false,
            None,
            Some("n3"),
        );
        g
    }

    #[test]
    fn isolation_from_a_pipe_reports_boundary_and_affected_customers() {
        let z = small_network().compute_isolation(Start::Pipe("p2"));
        // the check valve on p3 does not isolate, so the segment runs through to n4
        assert_eq!(z.isolated_pipes, fx(&["p2", "p3"]));
        assert_eq!(z.valves_to_close, fx(&["gate"]));
        assert_eq!(z.boundary_pipes, fx(&["p1"]));
        assert_eq!(z.affected_services, fx(&["svc"]));
    }

    #[test]
    fn a_valve_on_the_target_pipe_is_closed_and_the_segment_grows_from_both_ends() {
        let z = small_network().compute_isolation(Start::Pipe("p1"));
        assert!(z.isolated_pipes.contains(&"p1".to_string()));
        assert_eq!(z.valves_to_close, fx(&["gate"]));
        assert!(
            z.isolated_pipes.contains(&"p0".to_string())
                && z.isolated_pipes.contains(&"p2".to_string())
        );
    }

    #[test]
    fn unknown_start_gives_an_empty_zone() {
        assert_eq!(
            small_network().compute_isolation(Start::Pipe("nope")),
            IsolationZone::default()
        );
    }

    #[test]
    fn upstream_reaches_the_source_and_downstream_is_what_the_start_feeds() {
        let g = small_network();
        let up = g.trace_directed("n2", Direction::Upstream, 0);
        assert_eq!(up.source_node_ids, fx(&["R"]));
        assert_eq!(up.pipe_ids, fx(&["p0", "p1"]));
        let down = g.trace_directed("n2", Direction::Downstream, 0);
        assert_eq!(down.pipe_ids, fx(&["p2", "p3"]));
        assert_eq!(down.node_ids, fx(&["n2", "n3", "n4"]));
    }

    #[test]
    fn a_closed_valve_blocks_the_trace() {
        let mut g = small_network();
        g.set_device(
            "gate",
            "GateValve",
            &fx(&["isolates"]),
            true,
            Some("p1"),
            None,
        );
        assert!(g
            .trace_directed("n2", Direction::Upstream, 0)
            .source_node_ids
            .is_empty());
    }

    #[test]
    fn devices_installed_before_their_pipe_still_mark_it() {
        let mut g = NetworkGraph::default();
        g.set_device(
            "v",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p1"),
            None,
        );
        g.add_pipe("p1", "a", "b");
        assert!(g.pipe_has_valve("p1"));
    }

    #[test]
    fn nearest_valves_respects_k() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.set_device(
            "v1",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p1"),
            None,
        );
        g.set_device(
            "v2",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p2"),
            None,
        );
        assert_eq!(g.nearest_valves("n1", 1).len(), 1);
    }

    #[test]
    fn nearest_valves_reports_exact_hop_distance() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3"); // p2 connects nodes 1 and 2 hops from n1
        g.set_device(
            "v_mid",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p2"),
            None,
        );
        let valves = g.nearest_valves("n1", 5);
        assert_eq!(valves.len(), 1);
        // p2's nearer endpoint (n2) is 1 hop from n1 → distance 1, not 2.
        assert_eq!(valves[0].distance, 1);
        assert_eq!(valves[0].pipe_id, "p2");
    }

    #[test]
    fn validate_disconnected_tie_break_keeps_lexicographically_first_as_largest() {
        // Two equal-sized (size 2) components: {a1,a2} and {b1,b2}. The tie-break
        // sorts by ascending first-node-id, so {a1,a2} is "largest" (kept) and
        // {b1,b2} is the one reported.
        let mut g = NetworkGraph::default();
        g.add_pipe("pa", "a1", "a2");
        for n in ["a1", "a2"] {
            g.register_node(n);
        }
        g.add_pipe("pb", "b1", "b2");
        for n in ["b1", "b2"] {
            g.register_node(n);
        }
        let disc: Vec<_> = g
            .validate()
            .into_iter()
            .filter(|i| i.kind == IssueKind::DisconnectedComponent)
            .collect();
        assert_eq!(
            disc.len(),
            1,
            "exactly one of two equal components is reported"
        );
        assert_eq!(disc[0].asset_ids, vec!["b1".to_string(), "b2".to_string()]);
    }

    #[test]
    fn isolation_segment_bounded_by_valves() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2"); // valveless
        g.add_pipe("p2", "n2", "n3"); // valved boundary
        g.add_pipe("p3", "n3", "n4"); // valveless, outside
        for n in ["n1", "n2", "n3", "n4"] {
            g.register_node(n);
        }
        g.set_device(
            "v1",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p2"),
            None,
        );
        let z = g.compute_isolation_zone("n1");
        assert_eq!(z.valves_to_close, vec!["v1"]);
        assert_eq!(z.isolated_nodes, vec!["n1", "n2"]);
        assert_eq!(z.isolated_pipes, vec!["p1"]);
    }

    #[test]
    fn isolation_valve_directly_at_incident() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2"); // valved right at n1's edge
        g.register_node("n1");
        g.register_node("n2");
        g.set_device(
            "v1",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p1"),
            None,
        );
        let z = g.compute_isolation_zone("n1");
        assert_eq!(z.valves_to_close, vec!["v1"]);
        assert_eq!(z.isolated_nodes, vec!["n1"]);
        assert!(z.isolated_pipes.is_empty());
    }

    #[test]
    fn isolation_no_valves_returns_whole_component_no_valves() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        for n in ["n1", "n2", "n3"] {
            g.register_node(n);
        }
        let z = g.compute_isolation_zone("n1");
        assert!(z.valves_to_close.is_empty(), "no valves → not isolatable");
        assert_eq!(z.isolated_nodes, vec!["n1", "n2", "n3"]);
        assert_eq!(z.isolated_pipes, vec!["p1", "p2"]);
    }

    #[test]
    fn isolation_unknown_start_is_empty() {
        let g = NetworkGraph::default();
        let z = g.compute_isolation_zone("nope");
        assert!(
            z.valves_to_close.is_empty()
                && z.isolated_nodes.is_empty()
                && z.isolated_pipes.is_empty()
        );
    }

    #[test]
    fn isolation_collects_multiple_boundary_valves_at_junction() {
        // n2 is a junction with two valved exits (the common real-world case):
        // n1 --p1(no valve)-- n2 --p2(v1)-- n3
        //                     n2 --p3(v2)-- n4
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.add_pipe("p3", "n2", "n4");
        for n in ["n1", "n2", "n3", "n4"] {
            g.register_node(n);
        }
        g.set_device(
            "v1",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p2"),
            None,
        );
        g.set_device(
            "v2",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some("p3"),
            None,
        );
        let z = g.compute_isolation_zone("n1");
        assert_eq!(z.valves_to_close, vec!["v1", "v2"]);
        assert_eq!(z.isolated_nodes, vec!["n1", "n2"]);
        assert_eq!(z.isolated_pipes, vec!["p1"]);
    }

    #[test]
    #[ignore = "perf: run with --ignored"]
    fn isolation_zone_perf_100k_edges_under_budget() {
        // A 100k-edge valveless chain with a valve at the far end → the segment
        // from nd0 spans the whole chain (worst-case BFS). Asserts O(V+E) stays
        // well under the 200ms budget for a single run.
        let mut g = NetworkGraph::default();
        let n = 100_000usize;
        for i in 0..n {
            g.add_pipe(&format!("p{i}"), &format!("nd{i}"), &format!("nd{}", i + 1));
        }
        g.set_device(
            "vend",
            "GateValve",
            &fx(&["isolates"]),
            false,
            Some(&format!("p{}", n - 1)),
            None,
        );

        let start = std::time::Instant::now();
        let z = g.compute_isolation_zone("nd0");
        let elapsed = start.elapsed();

        assert_eq!(z.valves_to_close, vec!["vend"]);
        // The valve sits on the last pipe (nd{n-1}–nd{n}), so the far node nd{n}
        // is across the boundary and excluded. Segment = nd0..nd{n-1} = n nodes,
        // joined by the n-1 valveless pipes. Confirms the BFS walked the chain.
        assert_eq!(z.isolated_nodes.len(), n);
        assert_eq!(z.isolated_pipes.len(), n - 1);
        assert!(
            elapsed.as_millis() < 200,
            "isolation took {elapsed:?}, budget 200ms"
        );
    }
}
