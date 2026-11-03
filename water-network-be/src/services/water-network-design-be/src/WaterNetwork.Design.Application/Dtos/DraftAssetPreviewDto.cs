namespace WaterNetwork.Design.Application.Dtos;

public sealed record DraftAssetPreviewDto(
    string Id,
    string Kind,
    string AssetCode,
    string? ClientRef,
    string GeometryType,
    IReadOnlyList<IReadOnlyList<double>> Coordinates,
    string? FromRef,
    string? ToRef,
    string? HostRef,
    IReadOnlyDictionary<string, string> Attributes);
