namespace WaterNetwork.Design.Contracts.Events;
public sealed record NetworkEditOperationV1(string Id, string Action, string Kind, string? TargetId,
    int? ExpectedVersion, ReadyForGisAssetV1? After, ReadyForGisAssetV1? Before);
public sealed record NetworkEditIssueV1(string Code, string OperationId, string Field, string Message);
public sealed record NetworkEditInspectionV1(IReadOnlyList<NetworkEditOperationV1> Operations,
    IReadOnlyList<NetworkEditIssueV1> Errors);
public sealed record DesignNetworkEditsReadyV1(string RevisionId, string TenantId, string ApprovedBy,
    IReadOnlyList<NetworkEditOperationV1> Operations);
