use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use petgraph::stable_graph::{EdgeIndex, NodeIndex, StableUnGraph};
use petgraph::visit::EdgeRef;
use serde::{Deserialize, Serialize};

/// Edge payload: the pipe id plus the set of valve device ids hosted on it.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipeEdge {
    pub pipe_id: String,
    pub valves: HashSet<String>,
}

/// Vertex payload. `registered` is true once a NodeRegistered/NodeRelocated
/// event was applied; false means the vertex exists only because a pipe
/// referenced it (a placeholder / missing endpoint).
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeVertex {
    pub node_id: String,
    #[serde(default)]
    pub registered: bool,
}

/// A device's placement, tracked so deletes can find and unmark the host edge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DevicePlacement {
    pub device_type: String,
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IsolationZone {
    pub valves_to_close: Vec<String>,
    pub isolated_nodes: Vec<String>,
    pub isolated_pipes: Vec<String>,
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
            registered: false,
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
                valves: HashSet::new(),
            },
        );
        self.pipe_ix.insert(pipe_id.to_string(), ix);
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
        device_type: &str,
        host_pipe_id: Option<&str>,
        host_node_id: Option<&str>,
    ) {
        // If re-installing, clear any previous valve mark first.
        self.remove_device(device_id);
        let placement = DevicePlacement {
            device_type: device_type.to_string(),
            host_pipe_id: host_pipe_id.map(str::to_string),
            host_node_id: host_node_id.map(str::to_string),
        };
        if device_type == "Valve" {
            if let Some(pid) = host_pipe_id {
                if let Some(&ix) = self.pipe_ix.get(pid) {
                    self.graph[ix].valves.insert(device_id.to_string());
                }
            }
        }
        self.devices.insert(device_id.to_string(), placement);
    }

    pub fn remove_device(&mut self, device_id: &str) {
        if let Some(prev) = self.devices.remove(device_id) {
            if prev.device_type == "Valve" {
                if let Some(pid) = prev.host_pipe_id {
                    if let Some(&ix) = self.pipe_ix.get(&pid) {
                        self.graph[ix].valves.remove(device_id);
                    }
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

    /// Compute the valve-segment isolation zone around `start_node_id`: BFS over
    /// valveless pipes builds the segment; every valved pipe incident to it is a
    /// boundary whose valves must close. Empty if the start node is absent.
    pub fn compute_isolation_zone(&self, start_node_id: &str) -> IsolationZone {
        use std::collections::VecDeque;
        let Some(&start) = self.node_ix.get(start_node_id) else {
            return IsolationZone {
                valves_to_close: Vec::new(),
                isolated_nodes: Vec::new(),
                isolated_pipes: Vec::new(),
            };
        };
        let mut in_segment: HashSet<NodeIndex> = HashSet::new();
        let mut isolated_pipes: HashSet<String> = HashSet::new();
        let mut valves: HashSet<String> = HashSet::new();
        let mut q: VecDeque<NodeIndex> = VecDeque::new();
        in_segment.insert(start);
        q.push_back(start);
        while let Some(ix) = q.pop_front() {
            for e in self.graph.edges(ix) {
                let w = e.weight();
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
                    for v in &w.valves {
                        valves.insert(v.clone());
                    }
                }
            }
        }
        let mut isolated_nodes: Vec<String> = in_segment
            .iter()
            .map(|&i| self.graph[i].node_id.clone())
            .collect();
        let mut valves_to_close: Vec<String> = valves.into_iter().collect();
        let mut isolated_pipes_vec: Vec<String> = isolated_pipes.into_iter().collect();
        isolated_nodes.sort();
        valves_to_close.sort();
        isolated_pipes_vec.sort();
        IsolationZone {
            valves_to_close,
            isolated_nodes,
            isolated_pipes: isolated_pipes_vec,
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
        g.set_device("d1", "Valve", Some("p1"), None);
        assert!(g.pipe_has_valve("p1"));
        g.remove_device("d1");
        assert!(!g.pipe_has_valve("p1"));
    }

    #[test]
    fn non_valve_device_does_not_mark_edge() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.set_device("d1", "PressureSensor", Some("p1"), None);
        assert!(!g.pipe_has_valve("p1"));
    }

    #[test]
    fn remove_node_drops_orphaned_device_placements() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2"); // p1 is incident to n1
        g.set_device("d_pipe", "Valve", Some("p1"), None); // hosted on p1
        g.set_device("d_node", "Pump", None, Some("n1")); // hosted on n1
        g.set_device("d_keep", "Pump", None, Some("n2")); // hosted on the surviving node

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
        g.set_device("v_far", "Valve", Some("p3"), None); // ~2 hops from n1
        g.set_device("v_near", "Valve", Some("p1"), None); // 0 hops from n1
        let valves = g.nearest_valves("n1", 5);
        let ids: Vec<&str> = valves.iter().map(|v| v.device_id.as_str()).collect();
        assert_eq!(ids, vec!["v_near", "v_far"]);
        assert_eq!(valves[0].distance, 0);
        assert_eq!(valves[0].pipe_id, "p1");
        assert!(valves[1].distance <= 2);
    }

    #[test]
    fn nearest_valves_respects_k() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3");
        g.set_device("v1", "Valve", Some("p1"), None);
        g.set_device("v2", "Valve", Some("p2"), None);
        assert_eq!(g.nearest_valves("n1", 1).len(), 1);
    }

    #[test]
    fn nearest_valves_reports_exact_hop_distance() {
        let mut g = NetworkGraph::default();
        g.add_pipe("p1", "n1", "n2");
        g.add_pipe("p2", "n2", "n3"); // p2 connects nodes 1 and 2 hops from n1
        g.set_device("v_mid", "Valve", Some("p2"), None);
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
        g.set_device("v1", "Valve", Some("p2"), None);
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
        g.set_device("v1", "Valve", Some("p1"), None);
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
        g.set_device("v1", "Valve", Some("p2"), None);
        g.set_device("v2", "Valve", Some("p3"), None);
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
        g.set_device("vend", "Valve", Some(&format!("p{}", n - 1)), None);

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
