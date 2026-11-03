use std::time::Duration;

use topology_core::{from_bytes, to_bytes, TenantGraphs};
use tracing::{info, warn};

use crate::state::SharedState;

/// Snapshot-first warm-up (decision 0018). If a snapshot file exists, load it;
/// otherwise start empty (the consumer replays the durable queue from the start,
/// and a full GIS rebuild can be triggered separately). Returns the initial state.
pub async fn warm_up(snapshot_path: &str) -> TenantGraphs {
    match std::fs::read(snapshot_path) {
        Ok(bytes) => match from_bytes(&bytes) {
            Ok(state) => {
                info!(
                    path = snapshot_path,
                    tenants = state.tenant_count(),
                    version = state.version(),
                    "warm-up: snapshot loaded"
                );
                state
            }
            Err(e) => {
                warn!(error = %e, "warm-up: snapshot unreadable, starting empty");
                TenantGraphs::default()
            }
        },
        Err(_) => {
            info!(path = snapshot_path, "warm-up: no snapshot, starting empty");
            TenantGraphs::default()
        }
    }
}

/// Periodically persist the shared state to disk so the next warm-up is fast.
pub async fn snapshot_loop(state: SharedState, snapshot_path: String, every: Duration) {
    let mut tick = tokio::time::interval(every);
    loop {
        tick.tick().await;
        let bytes = {
            let g = state.graphs.read().await;
            to_bytes(&g)
        };
        match bytes {
            Ok(bytes) => {
                if let Some(parent) = std::path::Path::new(&snapshot_path).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                // Write to a temp file then rename so a crash mid-write can never
                // leave a half-written (corrupt) snapshot at `snapshot_path`.
                let tmp = format!("{snapshot_path}.tmp");
                if let Err(e) = std::fs::write(&tmp, &bytes)
                    .and_then(|()| std::fs::rename(&tmp, &snapshot_path))
                {
                    warn!(error = %e, "snapshot write failed");
                }
            }
            Err(e) => warn!(error = %e, "snapshot serialize failed"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use topology_core::{to_bytes, GraphEvent, GraphEventKind, TenantGraphs};

    #[tokio::test]
    async fn loads_existing_snapshot_when_present() {
        let dir = std::env::temp_dir().join(format!("topo-warmup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("snap.json");

        let mut seed = TenantGraphs::default();
        seed.apply(&GraphEvent {
            event_id: "e1".into(),
            tenant_id: "t1".into(),
            kind: GraphEventKind::NodeRegistered {
                node_id: "n1".into(),
                node_type: "J".into(),
                lat: 0.0,
                lng: 0.0,
            },
        });
        std::fs::write(&path, to_bytes(&seed).unwrap()).unwrap();

        let loaded = warm_up(path.to_str().unwrap()).await;
        assert!(loaded.tenant("t1").unwrap().has_node("n1"));
    }

    #[tokio::test]
    async fn returns_empty_when_no_snapshot() {
        let loaded = warm_up("/nonexistent/path/snap.json").await;
        assert_eq!(loaded.tenant_count(), 0);
    }
}
