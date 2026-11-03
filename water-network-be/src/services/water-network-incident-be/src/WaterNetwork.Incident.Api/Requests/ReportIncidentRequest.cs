using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Api.Requests;

public sealed record ReportIncidentAffectedRefRequest(string AssetId, AssetRefKind Kind);

public sealed record ReportIncidentRequest(
    IncidentCategory Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<ReportIncidentAffectedRefRequest>? AffectedRefs);
