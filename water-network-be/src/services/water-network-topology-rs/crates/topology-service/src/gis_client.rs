use serde::Deserialize;
use topology_core::{GraphEvent, GraphEventKind, TenantGraphs};

// wired in TOP-2 full-rebuild path
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ExportPage {
    items: Vec<ExportItem>,
    #[serde(rename = "nextCursor")]
    next_cursor: Option<String>,
}

// wired in TOP-2 full-rebuild path
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")] // gis-be serializes responses camelCase (ASP.NET default)
struct ExportItem {
    kind: String,
    id: String,
    node_type: Option<String>,
    from_node_id: Option<String>,
    to_node_id: Option<String>,
    diameter_mm: Option<i32>,
    material: Option<String>,
    length_m: Option<f64>,
    device_type: Option<String>,
    host_pipe_id: Option<String>,
    host_node_id: Option<String>,
}

// wired in TOP-2 full-rebuild path
#[allow(dead_code)]
pub struct GisRebuildClient {
    base_url: String,
    token: String,
    page_size: usize,
    http: reqwest::Client,
}

// wired in TOP-2 full-rebuild path
#[allow(dead_code)]
impl GisRebuildClient {
    pub fn new(base_url: String, token: String, page_size: usize) -> Self {
        GisRebuildClient {
            base_url,
            token,
            page_size,
            http: reqwest::Client::new(),
        }
    }

    /// Page the export endpoint for one tenant and apply every item into `tg`.
    /// Synthesizes deterministic event ids (`rebuild:<tenant>:<id>`) so a later
    /// live event with the real `event_id` is never deduped against the rebuild.
    pub async fn rebuild_tenant(
        &self,
        tenant_id: &str,
        tg: &mut TenantGraphs,
    ) -> Result<(), anyhow::Error> {
        let mut cursor: Option<String> = None;
        loop {
            let mut req = self
                .http
                .get(format!("{}/api/network/assets/export", self.base_url))
                .query(&[("limit", self.page_size.to_string())])
                .header("X-Tenant-Id", tenant_id);
            if !self.token.is_empty() {
                req = req.bearer_auth(&self.token);
            }
            if let Some(c) = &cursor {
                req = req.query(&[("cursor", c)]);
            }
            let page: ExportPage = req.send().await?.error_for_status()?.json().await?;
            for item in &page.items {
                if let Some(kind) = item_to_kind(item) {
                    tg.apply(&GraphEvent {
                        event_id: format!("rebuild:{tenant_id}:{}", item.id),
                        tenant_id: tenant_id.to_string(),
                        kind,
                    });
                }
            }
            match page.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        Ok(())
    }
}

// wired in TOP-2 full-rebuild path
#[allow(dead_code)]
fn item_to_kind(item: &ExportItem) -> Option<GraphEventKind> {
    match item.kind.as_str() {
        "Node" => Some(GraphEventKind::NodeRegistered {
            node_id: item.id.clone(),
            node_type: item.node_type.clone().unwrap_or_default(),
            lat: 0.0,
            lng: 0.0,
        }),
        "Pipe" => Some(GraphEventKind::PipeRegistered {
            pipe_id: item.id.clone(),
            from_node_id: item.from_node_id.clone()?,
            to_node_id: item.to_node_id.clone()?,
            length_m: item.length_m.unwrap_or(0.0),
            diameter_mm: item.diameter_mm.unwrap_or(0),
            material: item.material.clone().unwrap_or_default(),
        }),
        "Device" => Some(GraphEventKind::DeviceInstalled {
            device_id: item.id.clone(),
            device_type: item.device_type.clone().unwrap_or_default(),
            host_pipe_id: item.host_pipe_id.clone(),
            host_node_id: item.host_node_id.clone(),
            lat: 0.0,
            lng: 0.0,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use topology_core::TenantGraphs;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn pages_through_export_and_builds_graph() {
        let server = MockServer::start().await;

        // page 1: one node, cursor "node-1"
        Mock::given(method("GET"))
            .and(path("/api/network/assets/export"))
            .and(query_param("limit", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{"kind":"Node","id":"node-1","assetCode":"ND-1","nodeType":"Junction"}],
                "nextCursor": "node-1"
            })))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        // page 2: one pipe, no cursor (end)
        Mock::given(method("GET"))
            .and(path("/api/network/assets/export"))
            .and(query_param("cursor", "node-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [{"kind":"Pipe","id":"pipe-1","assetCode":"PP-1","fromNodeId":"node-1","toNodeId":"node-2"}],
                "nextCursor": serde_json::Value::Null
            })))
            .mount(&server)
            .await;

        let client = GisRebuildClient::new(server.uri(), "dev-token".into(), 2);
        let mut tg = TenantGraphs::default();
        client
            .rebuild_tenant("t1", &mut tg)
            .await
            .expect("rebuild ok");

        let g = tg.tenant("t1").unwrap();
        assert!(g.has_node("node-1"));
        assert!(g.has_pipe("pipe-1"));
    }
}
