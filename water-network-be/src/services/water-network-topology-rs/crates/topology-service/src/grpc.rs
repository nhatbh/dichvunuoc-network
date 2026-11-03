use tonic::{Request, Response, Status};

use crate::proto::topology_service_server::TopologyService;
use crate::proto::{
    ComputeIsolationZoneRequest, ComputeIsolationZoneResponse, FindNearestValvesRequest,
    FindNearestValvesResponse, IssueType, NearestValve, TopologyIssue, TraceNetworkRequest,
    TraceNetworkResponse, ValidateTopologyRequest, ValidateTopologyResponse,
};
use crate::state::SharedState;
use topology_core::IssueKind;

/// gRPC adapter over the shared per-tenant graph state. Read-only: each method
/// takes a read lock, looks up the tenant graph, runs a pure core analysis, and
/// maps the result to the proto response. An unknown tenant yields empty results
/// (not an error) — the graph is eventually consistent.
pub struct TopologyGrpc {
    state: SharedState,
}

impl TopologyGrpc {
    pub fn new(state: SharedState) -> Self {
        TopologyGrpc { state }
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
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let issues = match graphs.tenant(&req.tenant_id) {
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
        }))
    }

    async fn trace_network(
        &self,
        request: Request<TraceNetworkRequest>,
    ) -> Result<Response<TraceNetworkResponse>, Status> {
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let (node_ids, pipe_ids) = match graphs.tenant(&req.tenant_id) {
            Some(g) => g.trace(&req.start_node_id, req.max_depth),
            None => (Vec::new(), Vec::new()),
        };
        Ok(Response::new(TraceNetworkResponse {
            node_ids,
            pipe_ids,
            graph_version: graphs.version(),
        }))
    }

    async fn find_nearest_valves(
        &self,
        request: Request<FindNearestValvesRequest>,
    ) -> Result<Response<FindNearestValvesResponse>, Status> {
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let valves = match graphs.tenant(&req.tenant_id) {
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
        }))
    }

    async fn compute_isolation_zone(
        &self,
        request: Request<ComputeIsolationZoneRequest>,
    ) -> Result<Response<ComputeIsolationZoneResponse>, Status> {
        let req = request.into_inner();
        let graphs = self.state.graphs.read().await;
        let (valves_to_close, isolated_nodes, isolated_pipes) = match graphs.tenant(&req.tenant_id)
        {
            Some(g) => {
                let z = g.compute_isolation_zone(&req.start_node_id);
                (z.valves_to_close, z.isolated_nodes, z.isolated_pipes)
            }
            None => (Vec::new(), Vec::new(), Vec::new()),
        };
        Ok(Response::new(ComputeIsolationZoneResponse {
            valves_to_close,
            isolated_nodes,
            isolated_pipes,
            graph_version: graphs.version(),
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
            node_type: "J".into(),
            lat: 0.0,
            lng: 0.0,
        }));
        tg.apply(&ev(GraphEventKind::NodeRegistered {
            node_id: "n2".into(),
            node_type: "J".into(),
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
            device_type: "Valve".into(),
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
                node_type: "J".into(),
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
            device_type: "Valve".into(),
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
                start_node_id: "n1".into(),
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
                start_node_id: "n1".into(),
            })
            .await
            .unwrap()
            .into_inner();
        assert!(resp.valves_to_close.is_empty() && resp.isolated_nodes.is_empty());
    }
}
