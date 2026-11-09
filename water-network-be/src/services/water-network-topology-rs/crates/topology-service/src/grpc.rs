use std::collections::HashSet;
use std::sync::Arc;

use tonic::{Request, Response, Status};
use tracing::{info, warn};

use crate::gis_client::GisRebuildClient;
use crate::proto::compute_isolation_zone_request::Start as ProtoStart;
use crate::proto::topology_service_server::TopologyService;
use crate::proto::{
    ComputeIsolationZoneRequest, ComputeIsolationZoneResponse, FindNearestValvesRequest,
    FindNearestValvesResponse, IssueType, NearestValve, TopologyIssue, TraceDirection,
    TraceNetworkRequest, TraceNetworkResponse, ValidateTopologyRequest, ValidateTopologyResponse,
};
use crate::state::SharedState;
use topology_core::{Direction, IssueKind, Start};

/// Rebuilds a missing tenant graph from gis-be's export on the first query (decision 0029).
pub struct Rebuilder {
    client: GisRebuildClient,
    fallback_token: String,
    // one rebuild at a time; callers for the same tenant wait and then find it built
    running: tokio::sync::Mutex<HashSet<String>>,
}

impl Rebuilder {
    pub fn new(client: GisRebuildClient, fallback_token: String) -> Self {
        Rebuilder {
            client,
            fallback_token,
            running: tokio::sync::Mutex::new(HashSet::new()),
        }
    }
}

pub struct TopologyGrpc {
    state: SharedState,
    rebuild: Option<Arc<Rebuilder>>,
}

impl TopologyGrpc {
    pub fn new(state: SharedState) -> Self {
        TopologyGrpc {
            state,
            rebuild: None,
        }
    }

    pub fn with_rebuild(state: SharedState, rebuild: Arc<Rebuilder>) -> Self {
        TopologyGrpc {
            state,
            rebuild: Some(rebuild),
        }
    }

    /// The tenant has a graph, or one could be rebuilt now. False when it could not.
    async fn ensure_graph<T>(&self, request: &Request<T>, tenant_id: &str) -> bool {
        if self.state.graphs.read().await.tenant(tenant_id).is_some() {
            return true;
        }
        let Some(rebuild) = &self.rebuild else {
            return false;
        };
        let forwarded = request
            .metadata()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.trim_start_matches("Bearer ").trim().to_string())
            .unwrap_or_default();
        let token = if forwarded.is_empty() {
            rebuild.fallback_token.clone()
        } else {
            forwarded
        };
        let mut running = rebuild.running.lock().await;
        if self.state.graphs.read().await.tenant(tenant_id).is_some() {
            return true; // built while we waited
        }
        running.insert(tenant_id.to_string());
        let result = rebuild.client.fetch_tenant(tenant_id, &token).await;
        running.remove(tenant_id);
        match result {
            Ok(events) => {
                let mut graphs = self.state.graphs.write().await;
                for e in &events {
                    graphs.apply(e);
                }
                graphs.ensure_tenant(tenant_id);
                info!(
                    tenant = tenant_id,
                    assets = events.len(),
                    "graph rebuilt from gis-be export"
                );
                true
            }
            Err(e) => {
                warn!(tenant = tenant_id, error = %e, "graph rebuild from gis-be failed");
                false
            }
        }
    }
}

fn map_issue_kind(kind: &IssueKind) -> IssueType {
    match kind {
        IssueKind::OrphanNode => IssueType::OrphanNode,
        IssueKind::MissingEndpoint => IssueType::MissingEndpoint,
        IssueKind::DisconnectedComponent => IssueType::DisconnectedComponent,
    }
}

#[tonic::async_trait]
impl TopologyService for TopologyGrpc {
    async fn validate_topology(
        &self,
        request: Request<ValidateTopologyRequest>,
    ) -> Result<Response<ValidateTopologyResponse>, Status> {
        let tenant = request.get_ref().tenant_id.clone();
        let graph_ready = self.ensure_graph(&request, &tenant).await;
        let graphs = self.state.graphs.read().await;
        let issues = match graphs.tenant(&tenant) {
            Some(g) => g
                .validate()
                .into_iter()
                .map(|i| TopologyIssue {
                    r#type: map_issue_kind(&i.kind) as i32,
                    asset_ids: i.asset_ids,
                })
                .collect(),
            None => Vec::new(),
        };
        Ok(Response::new(ValidateTopologyResponse {
            issues,
            graph_version: graphs.version(),
            graph_ready,
        }))
    }

    async fn trace_network(
        &self,
        request: Request<TraceNetworkRequest>,
    ) -> Result<Response<TraceNetworkResponse>, Status> {
        let tenant = request.get_ref().tenant_id.clone();
        let graph_ready = self.ensure_graph(&request, &tenant).await;
        let req = request.into_inner();
        let direction = match TraceDirection::try_from(req.direction) {
            Ok(TraceDirection::Upstream) => Direction::Upstream,
            Ok(TraceDirection::Downstream) => Direction::Downstream,
            _ => Direction::All,
        };
        let graphs = self.state.graphs.read().await;
        let trace = graphs
            .tenant(&tenant)
            .map(|g| g.trace_directed(&req.start_node_id, direction, req.max_depth))
            .unwrap_or_default();
        Ok(Response::new(TraceNetworkResponse {
            node_ids: trace.node_ids,
            pipe_ids: trace.pipe_ids,
            graph_version: graphs.version(),
            source_node_ids: trace.source_node_ids,
            graph_ready,
        }))
    }

    async fn find_nearest_valves(
        &self,
        request: Request<FindNearestValvesRequest>,
    ) -> Result<Response<FindNearestValvesResponse>, Status> {
        let tenant = request.get_ref().tenant_id.clone();
        let graph_ready = self.ensure_graph(&request, &tenant).await;
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let valves = match graphs.tenant(&tenant) {
            Some(g) => g
                .nearest_valves(&req.start_node_id, req.k as usize)
                .into_iter()
                .map(|v| NearestValve {
                    device_id: v.device_id,
                    pipe_id: v.pipe_id,
                    distance: v.distance,
                })
                .collect(),
            None => Vec::new(),
        };
        Ok(Response::new(FindNearestValvesResponse {
            valves,
            graph_version: graphs.version(),
            graph_ready,
        }))
    }

    async fn compute_isolation_zone(
        &self,
        request: Request<ComputeIsolationZoneRequest>,
    ) -> Result<Response<ComputeIsolationZoneResponse>, Status> {
        let tenant = request.get_ref().tenant_id.clone();
        let graph_ready = self.ensure_graph(&request, &tenant).await;
        let req = request.into_inner();
        let start = match &req.start {
            Some(ProtoStart::StartNodeId(id)) => Start::Node(id),
            Some(ProtoStart::StartPipeId(id)) => Start::Pipe(id),
            None => {
                return Err(Status::invalid_argument(
                    "start_node_id or start_pipe_id is required",
                ))
            }
        };
        let graphs = self.state.graphs.read().await;
        let z = graphs
            .tenant(&tenant)
            .map(|g| g.compute_isolation(start))
            .unwrap_or_default();
        Ok(Response::new(ComputeIsolationZoneResponse {
            valves_to_close: z.valves_to_close,
            isolated_nodes: z.isolated_nodes,
            isolated_pipes: z.isolated_pipes,
            graph_version: graphs.version(),
            boundary_pipe_ids: z.boundary_pipes,
            affected_service_ids: z.affected_services,
            graph_ready,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::topology_service_client::TopologyServiceClient;
    use crate::proto::topology_service_server::TopologyServiceServer;
    use crate::proto::{
        FindNearestValvesRequest, IssueType, TraceNetworkRequest, ValidateTopologyRequest,
    };
    use crate::state::SharedState;
    use topology_core::{GraphEvent, GraphEventKind, TenantGraphs};

    fn seeded_state() -> SharedState {
        let mut tg = TenantGraphs::default();
        let mut n = 0u32;
        let mut ev = |kind| {
            n += 1;
            GraphEvent {
                event_id: format!("e{n}"),
                tenant_id: "t1".into(),
                kind,
            }
        };
        tg.apply(&ev(GraphEventKind::NodeRegistered {
            node_id: "n1".into(),
            component_code: "Junction".into(),
            functions: Vec::new(),
            lat: 0.0,
            lng: 0.0,
        }));
        tg.apply(&ev(GraphEventKind::NodeRegistered {
            node_id: "n2".into(),
            component_code: "Junction".into(),
            functions: Vec::new(),
            lat: 0.0,
            lng: 0.0,
        }));
        tg.apply(&ev(GraphEventKind::PipeRegistered {
            pipe_id: "p1".into(),
            from_node_id: "n1".into(),
            to_node_id: "n2".into(),
            length_m: 1.0,
            diameter_mm: 100,
            material: "HDPE".into(),
        }));
        tg.apply(&ev(GraphEventKind::DeviceInstalled {
            device_id: "v1".into(),
            component_code: "GateValve".into(),
            functions: vec!["isolates".into()],
            closed: false,
            host_pipe_id: Some("p1".into()),
            host_node_id: None,
            lat: 0.0,
            lng: 0.0,
        }));
        SharedState::new(tg)
    }

    async fn start_server(state: SharedState) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = TopologyServiceServer::new(TopologyGrpc::new(state));
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        addr
    }

    async fn client(
        addr: std::net::SocketAddr,
    ) -> TopologyServiceClient<tonic::transport::Channel> {
        for _ in 0..20 {
            if let Ok(c) = TopologyServiceClient::connect(format!("http://{addr}")).await {
                return c;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        panic!("could not connect to test gRPC server");
    }

    #[tokio::test]
    async fn validate_reports_no_issues_for_clean_graph() {
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let resp = c
            .validate_topology(ValidateTopologyRequest {
                tenant_id: "t1".into(),
            })
            .await
            .unwrap()
            .into_inner();
        assert!(resp.issues.is_empty());
        assert!(resp.graph_version >= 4);
    }

    #[tokio::test]
    async fn validate_flags_missing_endpoint() {
        let mut tg = TenantGraphs::default();
        tg.apply(&GraphEvent {
            event_id: "e1".into(),
            tenant_id: "t1".into(),
            kind: GraphEventKind::PipeRegistered {
                pipe_id: "p1".into(),
                from_node_id: "n1".into(),
                to_node_id: "ghost".into(),
                length_m: 1.0,
                diameter_mm: 100,
                material: "HDPE".into(),
            },
        });
        let addr = start_server(SharedState::new(tg)).await;
        let mut c = client(addr).await;
        let resp = c
            .validate_topology(ValidateTopologyRequest {
                tenant_id: "t1".into(),
            })
            .await
            .unwrap()
            .into_inner();
        assert!(resp
            .issues
            .iter()
            .any(|i| i.r#type == IssueType::MissingEndpoint as i32
                && i.asset_ids == vec!["ghost".to_string()]));
    }

    #[tokio::test]
    async fn trace_and_nearest_valves_work() {
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;

        let trace = c
            .trace_network(TraceNetworkRequest {
                tenant_id: "t1".into(),
                start_node_id: "n1".into(),
                max_depth: 5,
                direction: 0,
            })
            .await
            .unwrap()
            .into_inner();
        assert_eq!(trace.node_ids, vec!["n1", "n2"]);
        assert_eq!(trace.pipe_ids, vec!["p1"]);

        let valves = c
            .find_nearest_valves(FindNearestValvesRequest {
                tenant_id: "t1".into(),
                start_node_id: "n1".into(),
                k: 5,
            })
            .await
            .unwrap()
            .into_inner();
        assert_eq!(valves.valves.len(), 1);
        assert_eq!(valves.valves[0].device_id, "v1");
        assert_eq!(valves.valves[0].pipe_id, "p1");
    }

    #[tokio::test]
    async fn unknown_tenant_returns_empty_not_error() {
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let resp = c
            .validate_topology(ValidateTopologyRequest {
                tenant_id: "ghost-tenant".into(),
            })
            .await
            .unwrap()
            .into_inner();
        assert!(resp.issues.is_empty());
    }

    #[tokio::test]
    async fn compute_isolation_zone_returns_boundary_valves() {
        use crate::proto::ComputeIsolationZoneRequest;
        let mut tg = TenantGraphs::default();
        let mut n = 0u32;
        let mut ev = |kind| {
            n += 1;
            GraphEvent {
                event_id: format!("e{n}"),
                tenant_id: "t1".into(),
                kind,
            }
        };
        for id in ["n1", "n2", "n3"] {
            tg.apply(&ev(GraphEventKind::NodeRegistered {
                node_id: id.into(),
                component_code: "Junction".into(),
                functions: Vec::new(),
                lat: 0.0,
                lng: 0.0,
            }));
        }
        tg.apply(&ev(GraphEventKind::PipeRegistered {
            pipe_id: "p1".into(),
            from_node_id: "n1".into(),
            to_node_id: "n2".into(),
            length_m: 1.0,
            diameter_mm: 100,
            material: "HDPE".into(),
        }));
        tg.apply(&ev(GraphEventKind::PipeRegistered {
            pipe_id: "p2".into(),
            from_node_id: "n2".into(),
            to_node_id: "n3".into(),
            length_m: 1.0,
            diameter_mm: 100,
            material: "HDPE".into(),
        }));
        tg.apply(&ev(GraphEventKind::DeviceInstalled {
            device_id: "v1".into(),
            component_code: "GateValve".into(),
            functions: vec!["isolates".into()],
            closed: false,
            host_pipe_id: Some("p2".into()),
            host_node_id: None,
            lat: 0.0,
            lng: 0.0,
        }));

        let addr = start_server(SharedState::new(tg)).await;
        let mut c = client(addr).await;
        let resp = c
            .compute_isolation_zone(ComputeIsolationZoneRequest {
                tenant_id: "t1".into(),
                start: Some(ProtoStart::StartNodeId("n1".into())),
            })
            .await
            .unwrap()
            .into_inner();
        assert_eq!(resp.valves_to_close, vec!["v1"]);
        assert_eq!(resp.isolated_nodes, vec!["n1", "n2"]);
        assert_eq!(resp.isolated_pipes, vec!["p1"]);
        assert_eq!(resp.graph_version, 6); // 3 nodes + 2 pipes + 1 device, all applied once
    }

    #[tokio::test]
    async fn compute_isolation_zone_unknown_tenant_empty() {
        use crate::proto::ComputeIsolationZoneRequest;
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let resp = c
            .compute_isolation_zone(ComputeIsolationZoneRequest {
                tenant_id: "ghost".into(),
                start: Some(ProtoStart::StartNodeId("n1".into())),
            })
            .await
            .unwrap()
            .into_inner();
        assert!(resp.valves_to_close.is_empty() && resp.isolated_nodes.is_empty());
    }

    #[tokio::test]
    async fn isolation_from_a_pipe_and_directed_trace() {
        use crate::proto::ComputeIsolationZoneRequest;
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let zone = c
            .compute_isolation_zone(ComputeIsolationZoneRequest {
                tenant_id: "t1".into(),
                start: Some(ProtoStart::StartPipeId("p1".into())),
            })
            .await
            .unwrap()
            .into_inner();
        assert_eq!(zone.valves_to_close, vec!["v1"]);
        assert_eq!(zone.isolated_pipes, vec!["p1"]);
        assert_eq!(zone.boundary_pipe_ids, vec!["p1"]);
        assert!(zone.graph_ready);
        let missing = c
            .compute_isolation_zone(ComputeIsolationZoneRequest {
                tenant_id: "t1".into(),
                start: None,
            })
            .await
            .unwrap_err();
        assert_eq!(missing.code(), tonic::Code::InvalidArgument);
    }

    #[tokio::test]
    async fn first_query_for_an_unknown_tenant_rebuilds_from_the_export_once() {
        use crate::proto::ComputeIsolationZoneRequest;
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let gis = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/network/assets/export"))
            .and(header("authorization", "Bearer user-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": [
                    {"kind":"Device","id":"device-1","assetCode":"V","componentCode":"ButterflyValve","functions":["isolates"],"hostPipeId":"pipe-2"},
                    {"kind":"Node","id":"node-a","assetCode":"A","componentCode":"Junction","functions":["connects"]},
                    {"kind":"Node","id":"node-b","assetCode":"B","componentCode":"Tee","functions":["connects"]},
                    {"kind":"Node","id":"node-c","assetCode":"C","componentCode":"Junction","functions":["connects"]},
                    {"kind":"Pipe","id":"pipe-1","assetCode":"P1","fromNodeId":"node-a","toNodeId":"node-b"},
                    {"kind":"Pipe","id":"pipe-2","assetCode":"P2","fromNodeId":"node-b","toNodeId":"node-c"}
                ],
                "nextCursor": serde_json::Value::Null
            })))
            .expect(1)
            .mount(&gis)
            .await;
        let rebuild = Arc::new(Rebuilder::new(
            GisRebuildClient::new(gis.uri(), 100),
            String::new(),
        ));
        let state = SharedState::new(TenantGraphs::default());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = TopologyServiceServer::new(TopologyGrpc::with_rebuild(state, rebuild));
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        let mut c = client(addr).await;
        for _ in 0..2 {
            let mut req = tonic::Request::new(ComputeIsolationZoneRequest {
                tenant_id: "t9".into(),
                start: Some(ProtoStart::StartPipeId("pipe-1".into())),
            });
            req.metadata_mut()
                .insert("authorization", "Bearer user-token".parse().unwrap());
            let zone = c.compute_isolation_zone(req).await.unwrap().into_inner();
            assert!(zone.graph_ready);
            // the valve arrived before its pipe in the export and still bounds the segment
            assert_eq!(zone.valves_to_close, vec!["device-1"]);
            assert_eq!(zone.isolated_pipes, vec!["pipe-1"]);
        }
    }

    #[tokio::test]
    async fn without_a_rebuild_path_an_unknown_tenant_is_not_ready() {
        use crate::proto::ComputeIsolationZoneRequest;
        let addr = start_server(seeded_state()).await;
        let mut c = client(addr).await;
        let zone = c
            .compute_isolation_zone(ComputeIsolationZoneRequest {
                tenant_id: "ghost".into(),
                start: Some(ProtoStart::StartNodeId("n1".into())),
            })
            .await
            .unwrap()
            .into_inner();
        assert!(!zone.graph_ready);
    }
}
