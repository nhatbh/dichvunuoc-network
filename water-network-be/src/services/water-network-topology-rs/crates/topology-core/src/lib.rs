//! Pure, I/O-free core of the topology service.

pub mod apply;
pub mod events;
pub mod graph;
pub mod snapshot;

pub use apply::TenantGraphs;
pub use events::{GraphEvent, GraphEventKind, ParseError};
pub use graph::{
    CanonicalGraph, DevicePlacement, Direction, IsolationZone, IssueKind, NearestValve,
    NetworkGraph, NodeVertex, PipeEdge, Start, TopologyIssue, Trace,
};
pub use snapshot::{from_bytes, to_bytes};
