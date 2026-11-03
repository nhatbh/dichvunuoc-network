use futures_util::StreamExt;
use lapin::{
    options::{
        BasicAckOptions, BasicConsumeOptions, ExchangeDeclareOptions, QueueBindOptions,
        QueueDeclareOptions,
    },
    types::FieldTable,
    Connection, ConnectionProperties, ExchangeKind,
};
use topology_core::GraphEvent;
use tracing::{error, info, warn};

use crate::state::SharedState;

/// Connect, declare a durable queue, bind it to the fanout message exchange,
/// and apply every topology event to shared state. Acks after a successful
/// apply (or skip); a parse error is logged and acked (poison messages must not
/// block the queue — they cannot be retried into validity).
pub async fn run(
    amqp_url: &str,
    exchange: &str,
    queue: &str,
    state: SharedState,
) -> Result<(), anyhow::Error> {
    let conn = Connection::connect(amqp_url, ConnectionProperties::default()).await?;
    let channel = conn.create_channel().await?;

    // Declare both sides defensively: the exchange is durable+fanout (matches
    // MassTransit); the queue is durable so events persist while we are down.
    channel
        .exchange_declare(
            exchange,
            ExchangeKind::Fanout,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await?;
    channel
        .queue_declare(
            queue,
            QueueDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await?;
    channel
        .queue_bind(
            queue,
            exchange,
            "",
            QueueBindOptions::default(),
            FieldTable::default(),
        )
        .await?;

    let mut consumer = channel
        .basic_consume(
            queue,
            "topology-rs",
            BasicConsumeOptions::default(),
            FieldTable::default(),
        )
        .await?;
    info!(queue, exchange, "topology consumer started");

    while let Some(delivery) = consumer.next().await {
        let delivery = match delivery {
            Ok(d) => d,
            Err(e) => {
                error!(error = %e, "delivery error");
                continue;
            }
        };
        match GraphEvent::from_envelope_bytes(&delivery.data) {
            Ok(Some(event)) => {
                let mut graphs = state.graphs.write().await;
                let applied = graphs.apply(&event);
                drop(graphs);
                if applied {
                    info!(event_id = %event.event_id, tenant = %event.tenant_id, "applied");
                }
            }
            Ok(None) => { /* non-topology event: ignore */ }
            Err(e) => warn!(error = %e, "skipping unparseable message (poison)"),
        }
        delivery.ack(BasicAckOptions::default()).await?;
    }
    Ok(())
}
