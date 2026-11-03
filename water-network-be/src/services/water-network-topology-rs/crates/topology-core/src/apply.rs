use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::events::{GraphEvent, GraphEventKind};
use crate::graph::{CanonicalGraph, NetworkGraph};

/// All tenants' graphs plus the processed-event-id set (the inbox) and a
/// monotonically increasing version (count of effective applies).
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct TenantGraphs {
    graphs: BTreeMap<String, NetworkGraph>,
    processed: HashSet<String>,
    version: u64,
}

impl TenantGraphs {
    /// Apply one event. Returns `true` if it took effect, `false` if it was a
    /// duplicate (already-seen `event_id`). Idempotent by `event_id`.
    pub fn apply(&mut self, event: &GraphEvent) -> bool {
        if self.processed.contains(&event.event_id) {
            return false;
        }
        let g = self.graphs.entry(event.tenant_id.clone()).or_default();
        match &event.kind {
            GraphEventKind::NodeRegistered { node_id, .. } => {
                g.register_node(node_id);
            }
            GraphEventKind::NodeRelocated { node_id, .. } => {
                g.register_node(node_id);
            } // geometry-only; ensures vertex exists
            GraphEventKind::NodeDeleted { node_id } => {
                g.remove_node(node_id);
            }
            GraphEventKind::PipeRegistered {
                pipe_id,
                from_node_id,
                to_node_id,
                ..
            } => {
                g.add_pipe(pipe_id, from_node_id, to_node_id);
            }
            GraphEventKind::PipeDeleted { pipe_id } => {
                g.remove_pipe(pipe_id);
            }
            GraphEventKind::DeviceInstalled {
                device_id,
                device_type,
                host_pipe_id,
                host_node_id,
                ..
            } => g.set_device(
                device_id,
                device_type,
                host_pipe_id.as_deref(),
                host_node_id.as_deref(),
            ),
            GraphEventKind::DeviceDeleted { device_id } => {
                g.remove_device(device_id);
            }
        }
        self.processed.insert(event.event_id.clone());
        self.version += 1;
        true
    }

    pub fn tenant(&self, tenant_id: &str) -> Option<&NetworkGraph> {
        self.graphs.get(tenant_id)
    }
    pub fn tenant_count(&self) -> usize {
        self.graphs.len()
    }
    pub fn version(&self) -> u64 {
        self.version
    }
    pub fn already_processed(&self, event_id: &str) -> bool {
        self.processed.contains(event_id)
    }

    /// Deterministic, comparable view of every tenant's graph (used in tests).
    pub fn canonical(&self) -> BTreeMap<String, CanonicalGraph> {
        self.graphs
            .iter()
            .map(|(t, g)| (t.clone(), g.canonical()))
            .collect()
    }

    /// Rebuild transient indexes for every tenant after deserialization.
    pub fn reindex_all(&mut self) {
        for g in self.graphs.values_mut() {
            g.reindex();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{GraphEvent, GraphEventKind};
    use proptest::prelude::*;

    fn ev(id: &str, tenant: &str, kind: GraphEventKind) -> GraphEvent {
        GraphEvent {
            event_id: id.to_string(),
            tenant_id: tenant.to_string(),
            kind,
        }
    }

    #[test]
    fn applies_node_then_pipe_per_tenant() {
        let mut tg = TenantGraphs::default();
        tg.apply(&ev(
            "e1",
            "t1",
            GraphEventKind::NodeRegistered {
                node_id: "n1".into(),
                node_type: "Junction".into(),
                lat: 0.0,
                lng: 0.0,
            },
        ));
        tg.apply(&ev(
            "e2",
            "t1",
            GraphEventKind::PipeRegistered {
                pipe_id: "p1".into(),
                from_node_id: "n1".into(),
                to_node_id: "n2".into(),
                length_m: 1.0,
                diameter_mm: 100,
                material: "HDPE".into(),
            },
        ));
        let g = tg.tenant("t1").unwrap();
        assert_eq!(g.node_count(), 2);
        assert!(g.has_pipe("p1"));
        assert_eq!(tg.version(), 2);
    }

    #[test]
    fn tenants_are_isolated() {
        let mut tg = TenantGraphs::default();
        tg.apply(&ev(
            "e1",
            "t1",
            GraphEventKind::NodeRegistered {
                node_id: "n1".into(),
                node_type: "J".into(),
                lat: 0.0,
                lng: 0.0,
            },
        ));
        tg.apply(&ev(
            "e2",
            "t2",
            GraphEventKind::NodeRegistered {
                node_id: "n1".into(),
                node_type: "J".into(),
                lat: 0.0,
                lng: 0.0,
            },
        ));
        assert_eq!(tg.tenant("t1").unwrap().node_count(), 1);
        assert_eq!(tg.tenant("t2").unwrap().node_count(), 1);
        assert_eq!(tg.tenant_count(), 2);
    }

    #[test]
    fn duplicate_event_id_is_a_noop() {
        let mut tg = TenantGraphs::default();
        let e = ev(
            "dup",
            "t1",
            GraphEventKind::NodeRegistered {
                node_id: "n1".into(),
                node_type: "J".into(),
                lat: 0.0,
                lng: 0.0,
            },
        );
        assert!(tg.apply(&e), "first apply takes effect");
        assert!(!tg.apply(&e), "second apply is a no-op");
        assert_eq!(tg.tenant("t1").unwrap().node_count(), 1);
        assert_eq!(
            tg.version(),
            1,
            "version only advances on effective applies"
        );
    }

    proptest! {
        // apply(e); apply(e) == apply(e)  — replay safety for every event kind.
        #[test]
        fn applying_twice_equals_once(seq in proptest::collection::vec(0u8..7, 1..40)) {
            let mut once = TenantGraphs::default();
            let mut twice = TenantGraphs::default();
            for (i, code) in seq.iter().enumerate() {
                let e = sample_event(i, *code);
                once.apply(&e);
                twice.apply(&e);
                twice.apply(&e); // replay
            }
            prop_assert_eq!(once.canonical(), twice.canonical());
        }
    }

    // Deterministic event generator over a tiny fixed id space so collisions
    // (and thus add/remove interplay) actually happen.
    fn sample_event(i: usize, code: u8) -> GraphEvent {
        let n = |x: usize| format!("n{}", x % 4);
        let p = |x: usize| format!("p{}", x % 3);
        let d = |x: usize| format!("d{}", x % 3);
        let kind = match code {
            0 => GraphEventKind::NodeRegistered {
                node_id: n(i),
                node_type: "J".into(),
                lat: 0.0,
                lng: 0.0,
            },
            1 => GraphEventKind::NodeRelocated {
                node_id: n(i),
                lat: 1.0,
                lng: 1.0,
            },
            2 => GraphEventKind::NodeDeleted { node_id: n(i) },
            3 => GraphEventKind::PipeRegistered {
                pipe_id: p(i),
                from_node_id: n(i),
                to_node_id: n(i + 1),
                length_m: 1.0,
                diameter_mm: 100,
                material: "HDPE".into(),
            },
            4 => GraphEventKind::PipeDeleted { pipe_id: p(i) },
            5 => GraphEventKind::DeviceInstalled {
                device_id: d(i),
                device_type: "Valve".into(),
                host_pipe_id: Some(p(i)),
                host_node_id: None,
                lat: 0.0,
                lng: 0.0,
            },
            _ => GraphEventKind::DeviceDeleted { device_id: d(i) },
        };
        GraphEvent {
            event_id: format!("e{i}"),
            tenant_id: "t1".into(),
            kind,
        }
    }
}
