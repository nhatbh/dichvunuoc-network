using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ReportIncidentAssetRef(string AssetId, AssetRefKind Kind);

public sealed record ReportIncidentCommand(
    IncidentCategory Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<ReportIncidentAssetRef> AffectedRefs) : ICommand<string>;
