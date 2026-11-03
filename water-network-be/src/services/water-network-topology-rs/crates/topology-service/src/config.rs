/// Service configuration sourced from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    pub amqp_url: String,
    pub queue_name: String,
    pub exchange_name: String,
    // wired in TOP-2 full-rebuild path
    #[allow(dead_code)]
    pub gis_base_url: String,
    // wired in TOP-2 full-rebuild path
    #[allow(dead_code)]
    pub gis_token: String,
    pub snapshot_path: String,
    pub http_bind: String,
    pub grpc_bind: String,
    // wired in TOP-2 full-rebuild path
    #[allow(dead_code)]
    pub export_page_size: usize,
}

impl Config {
    pub fn from_env() -> Self {
        let get = |k: &str, default: &str| std::env::var(k).unwrap_or_else(|_| default.to_string());
        Config {
            amqp_url: get("TOPOLOGY_AMQP_URL", "amqp://guest:guest@rabbitmq:5672/%2f"),
            queue_name: get("TOPOLOGY_QUEUE", "water-network-topology-rs"),
            // Verified empirically in Task 8; default is the MassTransit URN-derived name.
            exchange_name: get(
                "TOPOLOGY_EXCHANGE",
                "WaterPlatform.BuildingBlocks.EventBus.Integration:IntegrationEventEnvelope",
            ),
            gis_base_url: get("TOPOLOGY_GIS_BASE_URL", "http://water-network-gis-be:8080"),
            gis_token: get("TOPOLOGY_GIS_TOKEN", ""),
            snapshot_path: get("TOPOLOGY_SNAPSHOT_PATH", "/app/data/topology-snapshot.json"),
            http_bind: get("TOPOLOGY_HTTP_BIND", "0.0.0.0:8080"),
            grpc_bind: get("TOPOLOGY_GRPC_BIND", "0.0.0.0:50051"),
            export_page_size: get("TOPOLOGY_EXPORT_PAGE_SIZE", "1000")
                .parse()
                .unwrap_or(1000),
        }
    }
}
