use crate::apply::TenantGraphs;

/// Serialize the whole state to JSON bytes. JSON keeps the snapshot
/// human-inspectable; switch to a binary codec only if size becomes a problem.
pub fn to_bytes(state: &TenantGraphs) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(state)
}

/// Deserialize and rebuild transient per-tenant indexes (which are `#[serde(skip)]`).
pub fn from_bytes(bytes: &[u8]) -> Result<TenantGraphs, serde_json::Error> {
    let mut state: TenantGraphs = serde_json::from_slice(bytes)?;
    state.reindex_all();
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{GraphEvent, GraphEventKind};

    #[test]
    fn round_trip_preserves_graph_and_dedup_and_indexes() {
        let mut tg = TenantGraphs::default();
        tg.apply(&GraphEvent {
            event_id: "e1".into(),
            tenant_id: "t1".into(),
            kind: GraphEventKind::PipeRegistered {
                pipe_id: "p1".into(),
                from_node_id: "n1".into(),
                to_node_id: "n2".into(),
                length_m: 1.0,
                diameter_mm: 100,
                material: "HDPE".into(),
            },
        });
        tg.apply(&GraphEvent {
            event_id: "e2".into(),
            tenant_id: "t1".into(),
            kind: GraphEventKind::DeviceInstalled {
                device_id: "d1".into(),
                device_type: "Valve".into(),
                host_pipe_id: Some("p1".into()),
                host_node_id: None,
                lat: 0.0,
                lng: 0.0,
            },
        });

        let bytes = to_bytes(&tg).expect("serialize");
        let mut restored = from_bytes(&bytes).expect("deserialize");

        // dedup survives
        assert!(restored.already_processed("e1"));
        // indexes were rebuilt → graph queries work and a fresh event lands correctly
        assert!(restored.tenant("t1").unwrap().pipe_has_valve("p1"));
        restored.apply(&GraphEvent {
            event_id: "e3".into(),
            tenant_id: "t1".into(),
            kind: GraphEventKind::PipeDeleted {
                pipe_id: "p1".into(),
            },
        });
        assert!(!restored.tenant("t1").unwrap().has_pipe("p1"));
    }
}
