use serde::Deserialize;
use topology_core::{GraphEvent, GraphEventKind};

#[derive(Debug, Deserialize)]
struct ExportPage {
    items: Vec<ExportItem>,
    #[serde(rename = "nextCursor")]
    next_cursor: Option<String>,
}

#[allow(dead_code)] // kind/id/geometry fields are kept for diagnostics
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")] // gis-be serializes responses camelCase (ASP.NET default)
struct ExportItem {
    kind: String,
    id: String,
    #[serde(default)]
    component_code: String,
    #[serde(default)]
    functions: Vec<String>,
    #[serde(default)]
    properties: std::collections::HashMap<String, String>,
    from_node_id: Option<String>,
    to_node_id: Option<String>,
    diameter_mm: Option<i32>,
    material: Option<String>,
    length_m: Option<f64>,
    host_pipe_id: Option<String>,
    host_node_id: Option<String>,
}

/// Rebuilds a tenant's graph from gis-be's export (`/api/network/assets/export`), with the
/// caller's bearer token so gis-be scopes the export to the caller's tenant (decision 0029).
pub struct GisRebuildClient {
    base_url: String,
    page_size: usize,
    http: reqwest::Client,
}

impl GisRebuildClient {
    pub fn new(base_url: String, page_size: usize) -> Self {
        GisRebuildClient {
            base_url,
            page_size,
            http: reqwest::Client::new(),
        }
    }

    /// Page the export for one tenant into graph events. Synthesizes deterministic event ids
    /// (`rebuild:<tenant>:<id>`) so a later live event with the real `event_id` is never
    /// deduped against the rebuild.
    pub async fn fetch_tenant(
        &self,
        tenant_id: &str,
        bearer: &str,
    ) -> Result<Vec<GraphEvent>, anyhow::Error> {
        let mut cursor: Option<String> = None;
        let mut events = Vec::new();
        loop {
            let mut req = self
                .http
                .get(format!("{}/api/network/assets/export", self.base_url))
                .query(&[("limit", self.page_size.to_string())])
                .header("X-Tenant-Id", tenant_id);
            if !bearer.is_empty() {
                req = req.bearer_auth(bearer);
            }
            if let Some(c) = &cursor {
                req = req.query(&[("cursor", c)]);
            }
            let page: ExportPage = req.send().await?.error_for_status()?.json().await?;
            for item in &page.items {
                if let Some(kind) = item_to_kind(item) {
                    events.push(GraphEvent {
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
        Ok(events)
    }

    /// Fetch and apply (tests).
    #[cfg(test)]
    pub async fn rebuild_tenant(
        &self,
        tenant_id: &str,
        bearer: &str,
        tg: &mut topology_core::TenantGraphs,
    ) -> Result<(), anyhow::Error> {
        for e in self.fetch_tenant(tenant_id, bearer).await? {
            tg.apply(&e);
        }
        tg.ensure_tenant(tenant_id);
        Ok(())
    }
}

fn item_to_kind(item: &ExportItem) -> Option<GraphEventKind> {
    match item.kind.as_str() {
        "Node" => Some(GraphEventKind::NodeRegistered {
            node_id: item.id.clone(),
            component_code: item.component_code.clone(),
            functions: item.functions.clone(),
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
            component_code: item.component_code.clone(),
            functions: item.functions.clone(),
            closed: item.properties.get("state").is_some_and(|s| s == "closed"),
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
                "items": [{"kind":"Node","id":"node-1","assetCode":"ND-1","componentCode":"Junction","functions":["connects"]}],
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

        let client = GisRebuildClient::new(server.uri(), 2);
        let mut tg = TenantGraphs::default();
        client
            .rebuild_tenant("t1", "dev-token", &mut tg)
            .await
            .expect("rebuild ok");

        let g = tg.tenant("t1").unwrap();
        assert!(g.has_node("node-1"));
        assert!(g.has_pipe("pipe-1"));
    }
}
