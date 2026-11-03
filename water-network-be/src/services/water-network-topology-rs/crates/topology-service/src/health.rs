use axum::{extract::State, routing::get, Json, Router};
use serde_json::json;

use crate::state::SharedState;

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(state)
}

async fn health(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let g = state.graphs.read().await;
    Json(json!({
        "status": "ok",
        "graphVersion": g.version(),
        "tenantCount": g.tenant_count()
    }))
}
