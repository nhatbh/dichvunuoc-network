use serde::Deserialize;

/// MassTransit envelope. PascalCase on the wire; `Payload` is a JSON *string*.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Envelope {
    event_id: String,
    event_type: String,
    #[serde(default)]
    payload: String,
}

/// The decoded `Payload` string: `{ EventType, EventVersion, ..., Data: {…} }`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct InnerPayload {
    data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct NodeRegisteredData {
    node_id: String,
    tenant_id: String,
    node_type: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct NodeRelocatedData {
    node_id: String,
    tenant_id: String,
    new_latitude: f64,
    new_longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct NodeDeletedData {
    node_id: String,
    tenant_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PipeRegisteredData {
    pipe_id: String,
    tenant_id: String,
    from_node_id: String,
    to_node_id: String,
    length_m: f64,
    diameter_mm: i32,
    material: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PipeDeletedData {
    pipe_id: String,
    tenant_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DeviceInstalledData {
    device_id: String,
    tenant_id: String,
    device_type: String,
    host_pipe_id: Option<String>,
    host_node_id: Option<String>,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DeviceDeletedData {
    device_id: String,
    tenant_id: String,
}

/// A topology-relevant event, tenant-scoped, with idempotency key.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphEvent {
    pub event_id: String,
    pub tenant_id: String,
    pub kind: GraphEventKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GraphEventKind {
    NodeRegistered {
        node_id: String,
        node_type: String,
        lat: f64,
        lng: f64,
    },
    NodeRelocated {
        node_id: String,
        lat: f64,
        lng: f64,
    },
    NodeDeleted {
        node_id: String,
    },
    PipeRegistered {
        pipe_id: String,
        from_node_id: String,
        to_node_id: String,
        length_m: f64,
        diameter_mm: i32,
        material: String,
    },
    PipeDeleted {
        pipe_id: String,
    },
    DeviceInstalled {
        device_id: String,
        device_type: String,
        host_pipe_id: Option<String>,
        host_node_id: Option<String>,
        lat: f64,
        lng: f64,
    },
    DeviceDeleted {
        device_id: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("invalid envelope json: {0}")]
    Envelope(serde_json::Error),
    #[error("invalid payload json: {0}")]
    Payload(serde_json::Error),
    #[error("invalid data for {event_type}: {source}")]
    Data {
        event_type: String,
        source: serde_json::Error,
    },
}

impl GraphEvent {
    /// Parse raw AMQP body. Returns `Ok(None)` for well-formed but non-topology
    /// events (filtered by `EventType`), `Err` only for malformed JSON.
    pub fn from_envelope_bytes(bytes: &[u8]) -> Result<Option<GraphEvent>, ParseError> {
        let env: Envelope = serde_json::from_slice(bytes).map_err(ParseError::Envelope)?;
        if !is_topology_event(&env.event_type) {
            return Ok(None);
        }
        let inner: InnerPayload =
            serde_json::from_str(&env.payload).map_err(ParseError::Payload)?;
        // Tenant always comes from the payload Data (read off the typed struct),
        // never the envelope — the envelope TenantId is null for outbox events.
        let (tenant_id, kind) =
            parse_kind(&env.event_type, inner.data).map_err(|source| ParseError::Data {
                event_type: env.event_type.clone(),
                source,
            })?;
        Ok(Some(GraphEvent {
            event_id: env.event_id,
            tenant_id,
            kind,
        }))
    }
}

fn is_topology_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "network.node.registered"
            | "network.node.relocated"
            | "network.node.deleted"
            | "network.pipe.registered"
            | "network.pipe.deleted"
            | "network.device.installed"
            | "network.device.deleted"
    )
}

/// Deserialize the typed `Data` for `event_type`, returning `(tenant_id, kind)`.
/// Reading `tenant_id` off each typed struct keeps the wire contract fully
/// validated by serde (no field is silently ignored).
fn parse_kind(
    event_type: &str,
    data: serde_json::Value,
) -> Result<(String, GraphEventKind), serde_json::Error> {
    Ok(match event_type {
        "network.node.registered" => {
            let d: NodeRegisteredData = serde_json::from_value(data)?;
            (
                d.tenant_id,
                GraphEventKind::NodeRegistered {
                    node_id: d.node_id,
                    node_type: d.node_type,
                    lat: d.latitude,
                    lng: d.longitude,
                },
            )
        }
        "network.node.relocated" => {
            let d: NodeRelocatedData = serde_json::from_value(data)?;
            (
                d.tenant_id,
                GraphEventKind::NodeRelocated {
                    node_id: d.node_id,
                    lat: d.new_latitude,
                    lng: d.new_longitude,
                },
            )
        }
        "network.node.deleted" => {
            let d: NodeDeletedData = serde_json::from_value(data)?;
            (
                d.tenant_id,
                GraphEventKind::NodeDeleted { node_id: d.node_id },
            )
        }
        "network.pipe.registered" => {
            let d: PipeRegisteredData = serde_json::from_value(data)?;
            (
                d.tenant_id,
                GraphEventKind::PipeRegistered {
                    pipe_id: d.pipe_id,
                    from_node_id: d.from_node_id,
                    to_node_id: d.to_node_id,
                    length_m: d.length_m,
                    diameter_mm: d.diameter_mm,
                    material: d.material,
                },
            )
        }
        "network.pipe.deleted" => {
            let d: PipeDeletedData = serde_json::from_value(data)?;
            (
                d.tenant_id,
                GraphEventKind::PipeDeleted { pipe_id: d.pipe_id },
            )
        }
        "network.device.installed" => {
            let d: DeviceInstalledData = serde_json::from_value(data)?;
            (
                d.tenant_id,
                GraphEventKind::DeviceInstalled {
                    device_id: d.device_id,
                    device_type: d.device_type,
                    host_pipe_id: d.host_pipe_id,
                    host_node_id: d.host_node_id,
                    lat: d.latitude,
                    lng: d.longitude,
                },
            )
        }
        "network.device.deleted" => {
            let d: DeviceDeletedData = serde_json::from_value(data)?;
            (
                d.tenant_id,
                GraphEventKind::DeviceDeleted {
                    device_id: d.device_id,
                },
            )
        }
        other => unreachable!("is_topology_event gated {other}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verbatim wire shape: envelope is PascalCase; Payload is a STRING whose
    // decoded form has a `Data` object with the typed fields (also PascalCase).
    fn node_registered_wire() -> String {
        let data = r#"{"NodeId":"node-1","TenantId":"t-1","AssetCode":"ND-1","NodeType":"Junction","Latitude":10.5,"Longitude":106.7}"#;
        let payload = serde_json::json!({
            "EventType": "network.node.registered",
            "EventVersion": 1,
            "Data": serde_json::from_str::<serde_json::Value>(data).unwrap()
        });
        serde_json::json!({
            "EventId": "evt-1",
            "EventType": "network.node.registered",
            "EventVersion": 1,
            "OccurredAt": "2026-06-17T00:00:00Z",
            "TenantId": serde_json::Value::Null,
            "Producer": "water-network-gis-be",
            "Payload": serde_json::to_string(&payload).unwrap()
        })
        .to_string()
    }

    #[test]
    fn parses_node_registered_into_graph_event() {
        let raw = node_registered_wire();
        let parsed = GraphEvent::from_envelope_bytes(raw.as_bytes())
            .expect("must parse")
            .expect("node.registered is a known type");
        assert_eq!(parsed.event_id, "evt-1");
        assert_eq!(parsed.tenant_id, "t-1");
        match parsed.kind {
            GraphEventKind::NodeRegistered { node_id, .. } => assert_eq!(node_id, "node-1"),
            other => panic!("wrong kind: {other:?}"),
        }
    }

    #[test]
    fn ignores_unknown_event_type() {
        let raw = node_registered_wire().replace("network.node.registered", "asset.registered");
        let parsed = GraphEvent::from_envelope_bytes(raw.as_bytes()).expect("valid json");
        assert!(parsed.is_none(), "non-topology events return Ok(None)");
    }

    // Wraps an arbitrary Data object into the full double-encoded envelope.
    fn wire(event_type: &str, data: serde_json::Value) -> String {
        let payload =
            serde_json::json!({ "EventType": event_type, "EventVersion": 1, "Data": data });
        serde_json::json!({
            "EventId": "evt-x", "EventType": event_type, "EventVersion": 1,
            "OccurredAt": "2026-06-17T00:00:00Z", "TenantId": serde_json::Value::Null,
            "Producer": "water-network-gis-be", "Payload": serde_json::to_string(&payload).unwrap()
        })
        .to_string()
    }

    #[test]
    fn parses_pipe_registered_field_mapping() {
        let raw = wire(
            "network.pipe.registered",
            serde_json::json!({
                "PipeId": "pipe-1", "TenantId": "t-9", "AssetCode": "PP-1",
                "FromNodeId": "n-a", "ToNodeId": "n-b", "LengthM": 12.5, "DiameterMm": 200, "Material": "HDPE"
            }),
        );
        let ev = GraphEvent::from_envelope_bytes(raw.as_bytes())
            .unwrap()
            .unwrap();
        assert_eq!(ev.tenant_id, "t-9");
        match ev.kind {
            GraphEventKind::PipeRegistered {
                pipe_id,
                from_node_id,
                to_node_id,
                diameter_mm,
                material,
                ..
            } => {
                assert_eq!(
                    (
                        pipe_id.as_str(),
                        from_node_id.as_str(),
                        to_node_id.as_str(),
                        diameter_mm,
                        material.as_str()
                    ),
                    ("pipe-1", "n-a", "n-b", 200, "HDPE")
                );
            }
            other => panic!("wrong kind: {other:?}"),
        }
    }

    #[test]
    fn parses_device_installed_valve_on_pipe() {
        let raw = wire(
            "network.device.installed",
            serde_json::json!({
                "DeviceId": "dev-1", "TenantId": "t-9", "AssetCode": "DV-1", "DeviceType": "Valve",
                "HostPipeId": "pipe-1", "HostNodeId": serde_json::Value::Null, "Latitude": 1.0, "Longitude": 2.0
            }),
        );
        let ev = GraphEvent::from_envelope_bytes(raw.as_bytes())
            .unwrap()
            .unwrap();
        match ev.kind {
            GraphEventKind::DeviceInstalled {
                device_id,
                device_type,
                host_pipe_id,
                host_node_id,
                ..
            } => {
                assert_eq!(device_id, "dev-1");
                assert_eq!(device_type, "Valve");
                assert_eq!(host_pipe_id.as_deref(), Some("pipe-1"));
                assert_eq!(host_node_id, None);
            }
            other => panic!("wrong kind: {other:?}"),
        }
    }
}
