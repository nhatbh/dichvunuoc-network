use std::sync::Arc;

use tokio::sync::RwLock;
use topology_core::TenantGraphs;

/// Graph state shared between the consumer (writer) and the health server (reader).
#[derive(Clone)]
pub struct SharedState {
    pub graphs: Arc<RwLock<TenantGraphs>>,
}

impl SharedState {
    pub fn new(initial: TenantGraphs) -> Self {
        SharedState {
            graphs: Arc::new(RwLock::new(initial)),
        }
    }
}
