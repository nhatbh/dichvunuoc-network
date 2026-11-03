//! gRPC types generated from `proto/topology.proto` at build time.
#![allow(clippy::all)]
tonic::include_proto!("waternetwork.topology.v1");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_types_are_constructible() {
        let req = ValidateTopologyRequest {
            tenant_id: "t1".into(),
        };
        assert_eq!(req.tenant_id, "t1");
        let issue = TopologyIssue {
            r#type: IssueType::OrphanNode as i32,
            asset_ids: vec!["n1".into()],
        };
        assert_eq!(issue.asset_ids, vec!["n1".to_string()]);
    }
}
