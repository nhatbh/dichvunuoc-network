//! Run with a live RabbitMQ:  cargo test -p topology-service --test consumer_rabbitmq -- --ignored
//!
//! This is a PUBLISH smoke test: it documents the exact wire bytes the consumer
//! must accept and confirms they can be published to the fanout exchange. The
//! full consume-and-assert path (graph reflects the event) is exercised against
//! the running binary in the TOP-1 end-to-end verification, not here.
use lapin::{
    options::*, types::FieldTable, BasicProperties, Connection, ConnectionProperties, ExchangeKind,
};

#[tokio::test]
#[ignore = "requires RabbitMQ at TOPOLOGY_AMQP_URL"]
async fn publishes_node_registered_envelope() {
    let url = std::env::var("TOPOLOGY_AMQP_URL")
        .unwrap_or_else(|_| "amqp://guest:guest@localhost:5672/%2f".into());
    let exchange = std::env::var("TOPOLOGY_EXCHANGE")
        .expect("set TOPOLOGY_EXCHANGE to the value discovered empirically");

    // Build the same envelope the .NET publisher emits.
    let data = serde_json::json!({"NodeId":"itnode-1","TenantId":"itt-1","AssetCode":"ND-IT","NodeType":"Junction","Latitude":10.0,"Longitude":106.0});
    let payload =
        serde_json::json!({"EventType":"network.node.registered","EventVersion":1,"Data":data})
            .to_string();
    let envelope = serde_json::json!({
        "EventId":"it-evt-1","EventType":"network.node.registered","EventVersion":1,
        "OccurredAt":"2026-06-17T00:00:00Z","TenantId":serde_json::Value::Null,
        "Producer":"test","Payload":payload
    })
    .to_string();

    let conn = Connection::connect(&url, ConnectionProperties::default())
        .await
        .unwrap();
    let ch = conn.create_channel().await.unwrap();
    ch.exchange_declare(
        &exchange,
        ExchangeKind::Fanout,
        ExchangeDeclareOptions {
            durable: true,
            ..Default::default()
        },
        FieldTable::default(),
    )
    .await
    .unwrap();
    ch.basic_publish(
        &exchange,
        "",
        BasicPublishOptions::default(),
        envelope.as_bytes(),
        BasicProperties::default().with_content_type("application/json".into()),
    )
    .await
    .unwrap();
}
