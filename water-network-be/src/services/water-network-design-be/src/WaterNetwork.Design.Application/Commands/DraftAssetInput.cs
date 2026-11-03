// DraftAssetInput.cs
using WaterNetwork.Design.Application.Geometry;

namespace WaterNetwork.Design.Application.Commands;

public sealed record DraftAssetInput(
    string Kind,
    string AssetCode,
    string? ClientRef,
    DraftGeometryInput Geometry,
    IReadOnlyDictionary<string, string> Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);
