mod config;
mod consumer;
mod gis_client;
mod grpc;
mod health;
mod proto;
mod state;
mod warmup;

use std::time::Duration;

use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use crate::{config::Config, state::SharedState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cfg = Config::from_env();
    info!(queue = %cfg.queue_name, exchange = %cfg.exchange_name, "starting water-network-topology-rs");

    let initial = warmup::warm_up(&cfg.snapshot_path).await;
    let shared = SharedState::new(initial);

    // periodic snapshot
    tokio::spawn(warmup::snapshot_loop(
        shared.clone(),
        cfg.snapshot_path.clone(),
        Duration::from_secs(30),
    ));

    // health server
    let health_state = shared.clone();
    let bind = cfg.http_bind.clone();
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(&bind)
            .await
            .expect("bind health port");
        info!(%bind, "health endpoint listening");
        axum::serve(listener, health::router(health_state))
            .await
            .expect("health server");
    });

    // gRPC server (+ standard gRPC health) — shares the same graph state.
    let grpc_state = shared.clone();
    let grpc_bind = cfg.grpc_bind.clone();
    tokio::spawn(async move {
        use crate::proto::topology_service_server::TopologyServiceServer;
        let addr = grpc_bind.parse().expect("valid TOPOLOGY_GRPC_BIND");
        let topology = TopologyServiceServer::new(crate::grpc::TopologyGrpc::new(grpc_state));

        let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
        health_reporter
            .set_serving::<TopologyServiceServer<crate::grpc::TopologyGrpc>>()
            .await;

        info!(%grpc_bind, "gRPC server listening");
        tonic::transport::Server::builder()
            .add_service(health_service)
            .add_service(topology)
            .serve(addr)
            .await
            .expect("gRPC server");
    });

    // consumer (foreground; reconnect-on-error loop keeps the service alive)
    loop {
        if let Err(e) = consumer::run(
            &cfg.amqp_url,
            &cfg.exchange_name,
            &cfg.queue_name,
            shared.clone(),
        )
        .await
        {
            error!(error = %e, "consumer stopped, retrying in 5s");
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}
