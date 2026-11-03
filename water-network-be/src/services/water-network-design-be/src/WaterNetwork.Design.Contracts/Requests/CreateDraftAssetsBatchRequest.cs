namespace WaterNetwork.Design.Contracts.Requests;

public sealed record CreateDraftAssetsBatchRequest(IReadOnlyList<CreateDraftAssetRequest> Assets);
