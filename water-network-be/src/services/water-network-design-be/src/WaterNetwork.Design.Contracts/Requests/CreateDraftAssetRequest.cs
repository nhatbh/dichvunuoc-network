namespace WaterNetwork.Design.Contracts.Requests;

public sealed record CreateDraftAssetRequest(
    string Kind,
    string AssetCode,
    string? ClientRef,
    GeometryRequest Geometry,
    IReadOnlyDictionary<string, string>? Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);
