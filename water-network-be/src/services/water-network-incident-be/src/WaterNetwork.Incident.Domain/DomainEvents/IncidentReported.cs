using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentReportedAssetRefData(string AssetId, string Kind, bool Verified);

public sealed record IncidentReportedData(
    string TenantId,
    string Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<IncidentReportedAssetRefData> AffectedRefs,
    string ReportedBy);

public sealed record IncidentReported(string AggregateId, IncidentReportedData Data)
    : DomainEventBase<IncidentReportedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentReported",
        data: Data);
